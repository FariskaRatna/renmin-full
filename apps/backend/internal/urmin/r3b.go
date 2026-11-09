package urmin

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/http"
	"regexp"
	"siera-delta-lima/backend/internal/devdemo"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

const maxAttachmentSize = 10 << 20

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var safeFilePattern = regexp.MustCompile(`^[a-zA-Z0-9 _().-]{1,160}$`)

type attachmentMeta struct {
	ID         string    `json:"id"`
	Filename   string    `json:"filename"`
	MIME       string    `json:"mime"`
	Size       int       `json:"size"`
	SHA256     string    `json:"sha256"`
	UploadedBy string    `json:"uploadedBy"`
	CreatedAt  time.Time `json:"createdAt"`
	DocKind    string    `json:"docKind"`
}
type delivery struct {
	ID             string     `json:"id"`
	IncomingID     string     `json:"incomingId"`
	AgendaNo       int64      `json:"agendaNo"`
	LetterNumber   string     `json:"letterNumber"`
	Subject        string     `json:"subject"`
	Classification string     `json:"classification"`
	Unit           string     `json:"unit"`
	Recipient      string     `json:"recipient"`
	RecipientName  string     `json:"recipientName"`
	Status         string     `json:"status"`
	SentAt         time.Time  `json:"sentAt"`
	ReceivedAt     *time.Time `json:"receivedAt"`
	Reason         string     `json:"reason"`
}
type deliveryEvent struct {
	Action string    `json:"action"`
	Actor  string    `json:"actor"`
	Reason string    `json:"reason"`
	At     time.Time `json:"at"`
}
type recipient struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Unit string `json:"unit"`
}

// The recipient must hold a currently active same-unit role grant and receive
// permission. The addressed distribution is NEVER general access to Urmin.
func (a *API) recipientEligible(ctx context.Context, userID, unit, classification string) (bool, error) {
	if demo, err := devdemo.Superadmin(ctx, a.DB, userID); err != nil || demo {
		return false, err // R5F20B: operational deny, including demo Superadmin
	}

	if !uuidPattern.MatchString(userID) || unit == "" {
		return false, nil
	}
	var ok bool
	err := a.DB.QueryRow(ctx, `SELECT EXISTS(
 SELECT 1 FROM sdl_users u
 JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$2
 JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=uu.unit_key AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now()) AND g.scope IN ('unit','assigned')
 JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active AND ro.role_key<>'superadmin'
 JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key='urmin.distribusi.receive'
 JOIN sdl_org_units ou ON ou.unit_key=uu.unit_key AND ou.is_active
 WHERE u.id=$1 AND u.is_active AND NOT u.must_change_password
 AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')
 AND ($3='biasa' OR g.classification_limit='penting')
 )`, userID, unit, classification).Scan(&ok)
	return ok, err
}
func (a *API) recipientOf(ctx context.Context, user, letterID, class string) (bool, error) {
	var unit string
	err := a.DB.QueryRow(ctx, `SELECT recipient_unit FROM sdl_urmin_distributions WHERE incoming_id=$1 AND recipient_user=$2 ORDER BY sent_at DESC LIMIT 1`, letterID, user).Scan(&unit)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return a.recipientEligible(ctx, user, unit, class)
}
func (a *API) sourceAccess(ctx context.Context, user, perm string, doc Incoming) (bool, error) {
	return a.decision(ctx, user, perm, doc)
}
func (a *API) canAttachment(ctx context.Context, user string, doc Incoming, permission string) (bool, error) {
	read, err := a.sourceAccess(ctx, user, "urmin.surat_masuk.read", doc)
	if err != nil {
		return false, err
	}
	if read {
		allowed, e := a.sourceAccess(ctx, user, permission, doc)
		if e != nil {
			return false, e
		}
		if allowed {
			return true, nil
		}
	}
	if permission == "urmin.surat_masuk.download" || permission == "urmin.surat_masuk.read" {
		recipientOK, err := a.recipientOf(ctx, user, doc.ID, doc.Classification)
		if err != nil || recipientOK {
			return recipientOK, err
		}
		return a.dispositionAttachmentAccess(ctx, user, doc)
	}
	return false, nil
}
func validateFile(filename string, b []byte) (string, bool) {
	filename = strings.TrimSpace(filename)
	if !safeFilePattern.MatchString(filename) || len(b) == 0 || len(b) > maxAttachmentSize {
		return "", false
	}
	mimeType := http.DetectContentType(b)
	lower := strings.ToLower(filename)
	if strings.HasSuffix(lower, ".pdf") && bytes.HasPrefix(b, []byte("%PDF-")) && mimeType == "application/pdf" && bytes.Contains(b[max(0, len(b)-2048):], []byte("%%EOF")) {
		return "application/pdf", true
	}
	if (strings.HasSuffix(lower, ".png") && mimeType == "image/png") || (strings.HasSuffix(lower, ".jpg") && mimeType == "image/jpeg") || (strings.HasSuffix(lower, ".jpeg") && mimeType == "image/jpeg") {
		cfg, format, err := image.DecodeConfig(bytes.NewReader(b))
		if err == nil && cfg.Width > 0 && cfg.Height > 0 && int64(cfg.Width)*int64(cfg.Height) <= 20000000 && ((mimeType == "image/png" && format == "png") || (mimeType == "image/jpeg" && format == "jpeg")) {
			return mimeType, true
		}
	}
	return "", false
}
func (a *API) attachmentList(w http.ResponseWriter, r *http.Request) {
	doc, err := a.load(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	allowed, err := a.canAttachment(r.Context(), actor(r.Context()), doc, "urmin.surat_masuk.read")
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 404, "not_found")
		return
	}
	// Naskah surat ('surat') selalu mendahului lampiran supaya urutan baris di
	// sini sama dengan urutan dua bagian di layar — atas lalu bawah.
	rows, err := a.DB.Query(r.Context(), `SELECT id::text,filename,mime_type,size_bytes,sha256,uploaded_by::text,created_at,doc_kind FROM sdl_urmin_incoming_attachments WHERE incoming_id=$1 ORDER BY (doc_kind<>'surat'),created_at,id LIMIT 50`, doc.ID)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	items := []attachmentMeta{}
	for rows.Next() {
		var v attachmentMeta
		if rows.Scan(&v.ID, &v.Filename, &v.MIME, &v.Size, &v.SHA256, &v.UploadedBy, &v.CreatedAt, &v.DocKind) != nil {
			fail(w, 503, "unavailable")
			return
		}
		items = append(items, v)
	}
	if rows.Err() != nil {
		fail(w, 503, "unavailable")
		return
	}
	user := actor(r.Context())
	canUpload := false
	canDownload := false
	canDistribute := false
	if doc.Status == "registered" {
		canUpload, err = a.canAttachment(r.Context(), user, doc, "urmin.surat_masuk.attach")
		if err != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		canDownload, err = a.canAttachment(r.Context(), user, doc, "urmin.surat_masuk.download")
		if err != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		sourceRead, e := a.decision(r.Context(), user, "urmin.surat_masuk.read", doc)
		if e != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		if sourceRead {
			canDistribute, e = a.decision(r.Context(), user, "urmin.surat_masuk.distribute", doc)
			if e != nil {
				fail(w, 503, "authorization_unavailable")
				return
			}
			if canDistribute {
				canDistribute, e = a.r5f7DistributionAllowed(r.Context(), doc.ID, user, doc.Classification)
				if e != nil {
					fail(w, 503, "authorization_unavailable")
					return
				}
			}
		}
	}
	jsonResponse(w, 200, map[string]any{"items": items, "canUpload": canUpload, "canDownload": canDownload, "canDistribute": canDistribute})
}
func (a *API) uploadAttachment(w http.ResponseWriter, r *http.Request) {
	doc, err := a.load(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	user := actor(r.Context())
	allowed, err := a.canAttachment(r.Context(), user, doc, "urmin.surat_masuk.attach")
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 403, "access_denied")
		return
	}
	if doc.Status != "registered" {
		fail(w, 409, "not_registered")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAttachmentSize+65536)
	if err = r.ParseMultipartForm(maxAttachmentSize + 65536); err != nil {
		fail(w, 413, "invalid_attachment")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, head, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, "file_required")
		return
	}
	defer file.Close()
	blob, err := io.ReadAll(io.LimitReader(file, maxAttachmentSize+1))
	if err != nil || len(blob) > maxAttachmentSize {
		fail(w, 413, "file_too_large")
		return
	}
	filename := head.Filename
	media, valid := validateFile(filename, blob)
	if !valid {
		fail(w, 400, "invalid_file_type")
		return
	}
	reason := strings.TrimSpace(r.FormValue("reason"))
	if !validReason(reason) {
		fail(w, 400, "invalid_reason")
		return
	}
	// Opsional: bagian form yang tidak dikirim berarti lampiran, sama dengan
	// DEFAULT kolomnya. Nilai di luar dua itu ditolak, bukan didiamkan jadi
	// lampiran — salah ketik di klien harus terlihat, bukan tersembunyi.
	docKind := strings.TrimSpace(r.FormValue("docKind"))
	if docKind == "" {
		docKind = "lampiran"
	}
	if docKind != "surat" && docKind != "lampiran" {
		fail(w, 400, "invalid_doc_kind")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	// Lock record and re-evaluate against DB state before writing.
	locked, err := scanDoc(tx.QueryRow(r.Context(), selectRecord+` WHERE id=$1 FOR UPDATE`, doc.ID))
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if locked.Status != "registered" || locked.Classification != doc.Classification {
		fail(w, 409, "document_changed")
		return
	}
	allowed, err = a.canAttachment(r.Context(), user, locked, "urmin.surat_masuk.attach")
	if err != nil || !allowed {
		fail(w, 403, "access_denied")
		return
	}
	var count int
	if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM sdl_urmin_incoming_attachments WHERE incoming_id=$1`, doc.ID).Scan(&count); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if count >= 10 {
		fail(w, 409, "attachment_limit")
		return
	}
	digest := sha256.Sum256(blob)
	var id string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_urmin_incoming_attachments(incoming_id,uploaded_by,filename,mime_type,size_bytes,sha256,body,doc_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`, doc.ID, user, filename, media, len(blob), hex.EncodeToString(digest[:]), blob, docKind).Scan(&id)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,'urmin.attachment.uploaded','urmin.attachment',$2,jsonb_build_object('incoming_id',$3::text,'reason',$4::text))`, user, id, doc.ID, reason); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 201, map[string]string{"id": id})
}
func (a *API) downloadAttachment(w http.ResponseWriter, r *http.Request) {
	id, att := chi.URLParam(r, "id"), chi.URLParam(r, "attachmentId")
	if !uuidPattern.MatchString(id) || !uuidPattern.MatchString(att) {
		fail(w, 404, "not_found")
		return
	}
	doc, err := a.load(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	allowed, err := a.canAttachment(r.Context(), actor(r.Context()), doc, "urmin.surat_masuk.download")
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 404, "not_found")
		return
	}
	var filename, media string
	var blob []byte
	var digest string
	err = a.DB.QueryRow(r.Context(), `SELECT filename,mime_type,body,sha256 FROM sdl_urmin_incoming_attachments WHERE id=$1 AND incoming_id=$2`, att, id).Scan(&filename, &media, &blob, &digest)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	actual := sha256.Sum256(blob)
	if hex.EncodeToString(actual[:]) != digest {
		fail(w, 503, "attachment_integrity_failure")
		return
	}
	if _, err = a.DB.Exec(r.Context(), `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,'urmin.attachment.downloaded','urmin.attachment',$2,jsonb_build_object('incoming_id',$3::text))`, actor(r.Context()), att, id); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", fmt.Sprint(len(blob)))
	_, _ = w.Write(blob)
}
func (a *API) candidateRecipients(w http.ResponseWriter, r *http.Request) {
	doc, err := a.load(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	u := actor(r.Context())
	read, e := a.decision(r.Context(), u, "urmin.surat_masuk.read", doc)
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	send, e := a.decision(r.Context(), u, "urmin.surat_masuk.distribute", doc)
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !read || !send || doc.Status != "registered" {
		fail(w, 403, "access_denied")
		return
	}
	unit := r.URL.Query().Get("unit")
	if unit != "urmin" && unit != "subbagren" && unit != "subbagsumda" && unit != "subbagbinfung" {
		fail(w, 400, "invalid_unit")
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT DISTINCT u.id::text,u.display_name FROM sdl_users u JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$1 WHERE u.is_active AND NOT u.must_change_password AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin') ORDER BY u.display_name LIMIT 100`, unit)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	items := []recipient{}
	for rows.Next() {
		var v recipient
		v.Unit = unit
		if rows.Scan(&v.ID, &v.Name) != nil {
			fail(w, 503, "unavailable")
			return
		}
		can, e := a.recipientEligible(r.Context(), v.ID, unit, doc.Classification)
		if e != nil {
			fail(w, 503, "unavailable")
			return
		}
		if can {
			items = append(items, v)
		}
	}
	if rows.Err() != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 200, map[string]any{"items": items})
}
func (a *API) sendDistribution(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Unit        string `json:"unit"`
		RecipientID string `json:"recipientId"`
		Reason      string `json:"reason"`
	}
	if !readJSON(w, r, &p) {
		return
	}
	if !uuidPattern.MatchString(p.RecipientID) || !validReason(p.Reason) || (p.Unit != "urmin" && p.Unit != "subbagren" && p.Unit != "subbagsumda" && p.Unit != "subbagbinfung") {
		fail(w, 400, "invalid_input")
		return
	}
	id, user := chi.URLParam(r, "id"), actor(r.Context())
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	doc, err := scanDoc(tx.QueryRow(r.Context(), selectRecord+` WHERE id=$1 FOR UPDATE`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if doc.Status != "registered" {
		fail(w, 409, "not_registered")
		return
	}
	read, e := a.decision(r.Context(), user, "urmin.surat_masuk.read", doc)
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	send, e := a.decision(r.Context(), user, "urmin.surat_masuk.distribute", doc)
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !read || !send {
		fail(w, 403, "access_denied")
		return
	}
	allowedRoute, e := a.r5f7DistributionAllowed(r.Context(), doc.ID, user, doc.Classification)
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowedRoute {
		fail(w, 403, "intake_route_restricted")
		return
	}
	good, e := a.recipientEligible(r.Context(), p.RecipientID, p.Unit, doc.Classification)
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !good {
		fail(w, 403, "invalid_recipient_permission")
		return
	}
	var pending bool
	if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_urmin_distributions WHERE incoming_id=$1 AND recipient_user=$2 AND status='sent')`, id, p.RecipientID).Scan(&pending); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if pending {
		fail(w, 409, "pending_delivery_exists")
		return
	}
	var distID string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_urmin_distributions(incoming_id,sent_by,recipient_unit,recipient_user,reason) VALUES($1,$2,$3,$4,$5) RETURNING id::text`, id, user, p.Unit, p.RecipientID, strings.TrimSpace(p.Reason)).Scan(&distID)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_urmin_distribution_events(distribution_id,actor_id,event_key,reason) VALUES($1,$2,'sent',$3)`, distID, user, strings.TrimSpace(p.Reason)); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if audit(r.Context(), tx, user, "urmin.distribution.sent", distID) != nil {
		fail(w, 503, "unavailable")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 201, map[string]string{"id": distID, "status": "sent"})
}
func scanDelivery(row interface{ Scan(...any) error }) (delivery, error) {
	var v delivery
	err := row.Scan(&v.ID, &v.IncomingID, &v.AgendaNo, &v.LetterNumber, &v.Subject, &v.Classification, &v.Unit, &v.Recipient, &v.RecipientName, &v.Status, &v.SentAt, &v.ReceivedAt, &v.Reason)
	return v, err
}

const deliverySelect = `SELECT d.id::text,d.incoming_id::text,i.agenda_no,i.letter_number,i.subject,i.classification,d.recipient_unit,d.recipient_user::text,u.display_name,d.status,d.sent_at,d.received_at,d.reason FROM sdl_urmin_distributions d JOIN sdl_urmin_incoming i ON i.id=d.incoming_id JOIN sdl_users u ON u.id=d.recipient_user`

func (a *API) distributions(w http.ResponseWriter, r *http.Request) {
	doc, err := a.load(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	user := actor(r.Context())
	ok, e := a.decision(r.Context(), user, "urmin.surat_masuk.read", doc)
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !ok {
		fail(w, 404, "not_found")
		return
	}
	rows, err := a.DB.Query(r.Context(), deliverySelect+` WHERE d.incoming_id=$1 ORDER BY d.sent_at DESC,d.id DESC LIMIT 100`, doc.ID)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	items := []delivery{}
	for rows.Next() {
		v, err := scanDelivery(rows)
		if err != nil {
			fail(w, 503, "unavailable")
			return
		}
		items = append(items, v)
	}
	if rows.Err() != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 200, map[string]any{"items": items})
}
func (a *API) inbox(w http.ResponseWriter, r *http.Request) {
	user := actor(r.Context())
	rows, err := a.DB.Query(r.Context(), deliverySelect+` WHERE d.recipient_user=$1 ORDER BY d.sent_at DESC,d.id DESC LIMIT 100`, user)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	items := []delivery{}
	for rows.Next() {
		v, e := scanDelivery(rows)
		if e != nil {
			fail(w, 503, "unavailable")
			return
		}
		good, e := a.recipientEligible(r.Context(), user, v.Unit, v.Classification)
		if e != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		if good {
			items = append(items, v)
		}
	}
	if rows.Err() != nil {
		fail(w, 503, "unavailable")
		return
	}
	pending := 0
	for _, v := range items {
		if v.Status == "sent" {
			pending++
		}
	}
	jsonResponse(w, 200, map[string]any{"items": items, "pending": pending, "limited": len(items) == 100})
}
func (a *API) receive(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Reason string `json:"reason"`
	}
	if !readJSON(w, r, &p) {
		return
	}
	if !validReason(p.Reason) {
		fail(w, 400, "invalid_reason")
		return
	}
	id, user := chi.URLParam(r, "distributionId"), actor(r.Context())
	if !uuidPattern.MatchString(id) {
		fail(w, 404, "not_found")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var unit, class, status string
	err = tx.QueryRow(r.Context(), `SELECT d.recipient_unit,i.classification,d.status FROM sdl_urmin_distributions d JOIN sdl_urmin_incoming i ON i.id=d.incoming_id WHERE d.id=$1 AND d.recipient_user=$2 FOR UPDATE OF d`, id, user).Scan(&unit, &class, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	ok, e := a.recipientEligible(r.Context(), user, unit, class)
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !ok {
		fail(w, 403, "access_denied")
		return
	}
	if status != "sent" {
		fail(w, 409, "already_received")
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE sdl_urmin_distributions SET status='received',received_at=now() WHERE id=$1`, id)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO sdl_urmin_distribution_events(distribution_id,actor_id,event_key,reason) VALUES($1,$2,'received',$3)`, id, user, strings.TrimSpace(p.Reason))
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if audit(r.Context(), tx, user, "urmin.distribution.received", id) != nil {
		fail(w, 503, "unavailable")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 200, map[string]string{"id": id, "status": "received"})
}
func (a *API) distributionEvents(w http.ResponseWriter, r *http.Request) {
	id, user := chi.URLParam(r, "distributionId"), actor(r.Context())
	if !uuidPattern.MatchString(id) {
		fail(w, 404, "not_found")
		return
	}
	var docID, unit, recipientID, class string
	err := a.DB.QueryRow(r.Context(), `SELECT incoming_id::text,recipient_unit,recipient_user::text,i.classification FROM sdl_urmin_distributions d JOIN sdl_urmin_incoming i ON i.id=d.incoming_id WHERE d.id=$1`, id).Scan(&docID, &unit, &recipientID, &class)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	authorized := false
	if user == recipientID {
		authorized, err = a.recipientEligible(r.Context(), user, unit, class)
	} else {
		var doc Incoming
		doc, err = a.load(r.Context(), docID)
		if err == nil {
			authorized, err = a.decision(r.Context(), user, "urmin.surat_masuk.read", doc)
		}
	}
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !authorized {
		fail(w, 404, "not_found")
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT e.event_key,u.display_name,e.reason,e.created_at FROM sdl_urmin_distribution_events e JOIN sdl_users u ON u.id=e.actor_id WHERE e.distribution_id=$1 ORDER BY e.created_at,e.id`, id)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	events := []deliveryEvent{}
	for rows.Next() {
		var v deliveryEvent
		if rows.Scan(&v.Action, &v.Actor, &v.Reason, &v.At) != nil {
			fail(w, 503, "unavailable")
			return
		}
		events = append(events, v)
	}
	if rows.Err() != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 200, map[string]any{"items": events})
}

func (a *API) R3BRoutes(r chi.Router) {
	r.Get("/{id}/attachments", a.attachmentList)
	r.Post("/{id}/attachments", a.uploadAttachment)
	r.Get("/{id}/attachments/{attachmentId}/download", a.downloadAttachment)
	r.Get("/{id}/recipient-candidates", a.candidateRecipients)
	r.Get("/{id}/distributions", a.distributions)
	r.Get("/{id}/disposition-tracking", a.dispositionTracking)
	r.Post("/{id}/distributions", a.sendDistribution)
}
func (a *API) R3BInboxRoutes(r chi.Router) {
	r.Get("/", a.inbox)
	r.Post("/{distributionId}/receive", a.receive)
	r.Get("/{distributionId}/events", a.distributionEvents)
	a.R3CInboxRoutes(r)
}
