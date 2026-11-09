package urmin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// R5F7 is an additive intake endpoint. It writes letter, metadata, attachments,
// optional Kabag delivery, events and audit in ONE database transaction.
// Existing R3A create/edit/register and R3B endpoints are unchanged.
type flexibleIntake struct {
	ID               string `json:"id"`
	Version          int64  `json:"version"`
	LetterNumber     string `json:"letterNumber"`
	Sender           string `json:"sender"`
	LetterDate       string `json:"letterDate"`
	ReceivedDate     string `json:"receivedDate"`
	Subject          string `json:"subject"`
	Classification   string `json:"classification"`
	Derajat          string `json:"derajat"`
	Reason           string `json:"reason"`
	LetterKind       string `json:"letterKind"`
	ResponseDue      string `json:"responseDue"`
	EventStart       string `json:"eventStart"`
	EventEnd         string `json:"eventEnd"`
	EventLocation    string `json:"eventLocation"`
	EventAgenda      string `json:"eventAgenda"`
	Details          string `json:"details"`
	NeedsDisposition bool   `json:"needsDisposition"`
	Mode             string `json:"mode"` // draft|submit
}
type intakeMeta struct {
	LetterKind       string     `json:"letterKind"`
	ResponseDue      *string    `json:"responseDue"`
	EventStart       *string    `json:"eventStart"`
	EventEnd         *string    `json:"eventEnd"`
	EventLocation    string     `json:"eventLocation"`
	EventAgenda      string     `json:"eventAgenda"`
	Details          string     `json:"details"`
	NeedsDisposition bool       `json:"needsDisposition"`
	RouteStatus      string     `json:"routeStatus"`
	KabagRecipient   *string    `json:"kabagRecipient"`
	SubmittedAt      *time.Time `json:"submittedAt"`
	WorkflowStatus   string     `json:"workflowStatus"`
}
type intakeFile struct {
	filename, mime string
	body           []byte
	// 'surat' untuk naskah suratnya sendiri, 'lampiran' untuk berkas pendukung.
	// Dibawa per berkas, bukan per request, karena satu intake boleh mengirim
	// keduanya sekaligus lewat dua field multipart yang berbeda.
	docKind string
}

func (a *API) R5F7Routes(r chi.Router) {
	r.Post("/intake", a.intakeWrite)
	r.Get("/{id}/intake", a.intakeRead)
}
func validDateTimeLocal(value string) bool {
	if value == "" {
		return true
	}
	t, err := time.Parse("2006-01-02T15:04", value)
	return err == nil && t.Format("2006-01-02T15:04") == value
}
func validateFlexible(p flexibleIntake) bool {
	core := payload{LetterNumber: p.LetterNumber, Sender: p.Sender, LetterDate: p.LetterDate, ReceivedDate: p.ReceivedDate, Subject: p.Subject, Classification: p.Classification, Derajat: p.Derajat, Reason: p.Reason}
	if !validPayload(core) || (p.Mode != "draft" && p.Mode != "submit") {
		return false
	}
	switch p.LetterKind {
	case "undangan", "permintaan", "pemberitahuan", "lainnya":
	default:
		return false
	}
	if p.ResponseDue != "" && !validDate(p.ResponseDue) {
		return false
	}
	if !validDateTimeLocal(p.EventStart) || !validDateTimeLocal(p.EventEnd) {
		return false
	}
	if p.EventEnd != "" && (p.EventStart == "" || p.EventEnd < p.EventStart) {
		return false
	}
	if !validText(p.EventLocation, 0, 240) || !validText(p.EventAgenda, 0, 500) || !validText(p.Details, 0, 1000) {
		return false
	}
	if p.LetterKind == "undangan" && p.Mode == "submit" && p.EventStart == "" {
		return false
	}
	if p.LetterKind == "permintaan" && p.Mode == "submit" && p.ResponseDue == "" {
		return false
	}
	if p.ID != "" && (!uuidPattern.MatchString(p.ID) || p.Version < 1) {
		return false
	}
	return true
}
func dateArg(v string) any {
	if v == "" {
		return nil
	}
	return v
}
func (a *API) kabagForIntake(ctx context.Context, class string) (string, error) {
	rows, err := a.DB.Query(ctx, `SELECT DISTINCT u.id::text FROM sdl_users u
 JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key='urmin'
 JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key='urmin' AND g.role_key='br_kabagrenmin' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now())
 JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
 WHERE u.is_active AND NOT u.must_change_password AND NOT EXISTS (SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin')
 AND ($1='biasa' OR g.classification_limit='penting') LIMIT 3`, class)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return "", err
		}
		ids = append(ids, id)
	}
	if err = rows.Err(); err != nil {
		return "", err
	}
	if len(ids) != 1 {
		return "", errors.New("kabag_not_unique_or_unavailable")
	}
	valid, err := a.recipientEligible(ctx, ids[0], "urmin", class)
	if err != nil || !valid {
		return "", errors.New("kabag_not_eligible")
	}
	return ids[0], nil
}

// intakeServerFailure emits only a fixed operation name and safe PostgreSQL diagnostics.
// Never log request payloads, filenames, actor identities, document contents, or SQL text.
// The client response remains unchanged to avoid exposing internal schema details.
func intakeServerFailure(w http.ResponseWriter, stage string, cause error, responseCode string) {
	sqlstate := "none"
	constraint := "none"
	var pgErr *pgconn.PgError
	if errors.As(cause, &pgErr) {
		sqlstate = pgErr.Code
		if pgErr.ConstraintName != "" {
			constraint = pgErr.ConstraintName
		}
	}
	if os.Getenv("SDL_ENV") == "development" {
		slog.Error("urmin_intake_failure", "stage", stage, "sqlstate", sqlstate, "constraint", constraint)
	}
	fail(w, http.StatusServiceUnavailable, responseCode)
}

func (a *API) intakeWrite(w http.ResponseWriter, r *http.Request) {
	const maxRequest = int64(10*maxAttachmentSize + 1024*1024)
	r.Body = http.MaxBytesReader(w, r.Body, maxRequest)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		fail(w, 413, "invalid_intake_size")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	if len(r.MultipartForm.Value["payload"]) != 1 {
		fail(w, 400, "payload_required")
		return
	}
	raw := r.FormValue("payload")
	if len(raw) > 16000 {
		fail(w, 400, "invalid_body")
		return
	}
	var p flexibleIntake
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&p); err != nil || !validateFlexible(p) {
		fail(w, 400, "invalid_intake")
		return
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		fail(w, 400, "invalid_body")
		return
	}
	// Naskah surat dikirim lewat field 'surat', lampiran lewat 'files'. Field
	// 'surat' opsional dan paling banyak satu: surat masuk hanya punya satu
	// naskah, dan menerima beberapa akan membuat bagian atas layar ambigu.
	// Batas gabungannya tetap 10 supaya MaxBytesReader di atas tidak terlampaui.
	suratHeaders := r.MultipartForm.File["surat"]
	if len(suratHeaders) > 1 {
		fail(w, 400, "too_many_files")
		return
	}
	headers := r.MultipartForm.File["files"]
	if len(headers)+len(suratHeaders) > 10 {
		fail(w, 400, "too_many_files")
		return
	}
	if p.Mode == "draft" && len(headers)+len(suratHeaders) > 0 {
		fail(w, 400, "draft_files_not_supported")
		return
	}
	files := make([]intakeFile, 0, len(headers)+len(suratHeaders))
	// Naskah lebih dulu supaya urutan baris di database mengikuti urutan tampil.
	for _, group := range []struct {
		headers []*multipart.FileHeader
		kind    string
	}{{suratHeaders, "surat"}, {headers, "lampiran"}} {
		for _, h := range group.headers {
			if h.Size < 1 || h.Size > maxAttachmentSize {
				fail(w, 413, "file_too_large")
				return
			}
			f, err := h.Open()
			if err != nil {
				fail(w, 400, "invalid_file")
				return
			}
			blob, e := io.ReadAll(io.LimitReader(f, maxAttachmentSize+1))
			f.Close()
			if e != nil {
				fail(w, 400, "invalid_file")
				return
			}
			mime, valid := validateFile(h.Filename, blob)
			if !valid {
				fail(w, 400, "invalid_file_type")
				return
			}
			files = append(files, intakeFile{h.Filename, mime, blob, group.kind})
		}
	}
	user := actor(r.Context())
	newDoc := Incoming{CreatedBy: user, Classification: p.Classification, Status: "draft"}
	perm := "urmin.surat_masuk.create"
	if p.ID != "" {
		perm = "urmin.surat_masuk.update"
	}
	ok, err := a.decision(r.Context(), user, perm, newDoc)
	if err != nil {
		intakeServerFailure(w, "check_create_permission", err, "authorization_unavailable")
		return
	}
	if !ok {
		fail(w, 403, "access_denied")
		return
	}
	if len(files) > 0 {
		fileDoc := newDoc
		fileDoc.Status = "registered"
		allowed, e := a.decision(r.Context(), user, "urmin.surat_masuk.attach", fileDoc)
		if e != nil {
			intakeServerFailure(w, "check_upload_permission", e, "authorization_unavailable")
			return
		}
		if !allowed {
			fail(w, 403, "attachment_permission_required")
			return
		}
	}
	kabag := ""
	if p.Mode == "submit" && p.NeedsDisposition {
		kabag, err = a.kabagForIntake(r.Context(), p.Classification)
		if err != nil {
			fail(w, 409, "kabagrenmin_not_available_or_ambiguous")
			return
		}
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		intakeServerFailure(w, "start_transaction", err, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var doc Incoming
	if p.ID == "" {
		doc, err = scanDoc(tx.QueryRow(r.Context(), `INSERT INTO sdl_urmin_incoming(letter_number,sender,letter_date,received_date,subject,classification,derajat,created_by,updated_by)
 VALUES($1,$2,$3::date,$4::date,$5,$6,$7,$8,$8)
 RETURNING id::text,agenda_no,letter_number,sender,letter_date::text,received_date::text,subject,classification,derajat,status,created_by::text,version,created_at,updated_at`, strings.TrimSpace(p.LetterNumber), strings.TrimSpace(p.Sender), p.LetterDate, p.ReceivedDate, strings.TrimSpace(p.Subject), p.Classification, normalizeDerajat(p.Derajat), user))
		if err != nil {
			intakeServerFailure(w, "insert_incoming_letter", err, "unavailable")
			return
		}
		if err = addHistory(r.Context(), tx, doc.ID, user, "created", nil, "draft", strings.TrimSpace(p.Reason), doc.Version); err != nil {
			intakeServerFailure(w, "insert_created_history", err, "unavailable")
			return
		}
		if err = audit(r.Context(), tx, user, "urmin.surat_masuk.created", doc.ID); err != nil {
			intakeServerFailure(w, "audit_created", err, "unavailable")
			return
		}
	} else {
		doc, err = scanDoc(tx.QueryRow(r.Context(), selectRecord+` WHERE id=$1 FOR UPDATE`, p.ID))
		if errors.Is(err, pgx.ErrNoRows) {
			fail(w, 404, "not_found")
			return
		}
		if err != nil {
			intakeServerFailure(w, "load_existing_draft", err, "unavailable")
			return
		}
		allowed, e := a.decision(r.Context(), user, "urmin.surat_masuk.update", doc)
		if e != nil {
			intakeServerFailure(w, "check_update_permission", e, "authorization_unavailable")
			return
		}
		if !allowed {
			fail(w, 404, "not_found")
			return
		}
		if doc.Status != "draft" || doc.Version != p.Version {
			fail(w, 409, "version_or_status_conflict")
			return
		}
		if len(files) > 0 {
			attachDoc := doc
			attachDoc.Status = "registered"
			allowedAttach, e := a.canAttachment(r.Context(), user, attachDoc, "urmin.surat_masuk.attach")
			if e != nil {
				intakeServerFailure(w, "check_existing_upload_permission", e, "authorization_unavailable")
				return
			}
			if !allowedAttach {
				fail(w, 403, "attachment_permission_required")
				return
			}
			var count int
			if e = tx.QueryRow(r.Context(), `SELECT count(*) FROM sdl_urmin_incoming_attachments WHERE incoming_id=$1`, doc.ID).Scan(&count); e != nil {
				intakeServerFailure(w, "count_existing_attachments", e, "unavailable")
				return
			}
			if count+len(files) > 10 {
				fail(w, 409, "attachment_limit")
				return
			}
		}
		doc, err = scanDoc(tx.QueryRow(r.Context(), `UPDATE sdl_urmin_incoming SET letter_number=$1,sender=$2,letter_date=$3::date,received_date=$4::date,subject=$5,classification=$6,derajat=$7,updated_by=$8,updated_at=now(),version=version+1 WHERE id=$9
 RETURNING id::text,agenda_no,letter_number,sender,letter_date::text,received_date::text,subject,classification,derajat,status,created_by::text,version,created_at,updated_at`, strings.TrimSpace(p.LetterNumber), strings.TrimSpace(p.Sender), p.LetterDate, p.ReceivedDate, strings.TrimSpace(p.Subject), p.Classification, normalizeDerajat(p.Derajat), user, p.ID))
		if err != nil {
			intakeServerFailure(w, "update_draft", err, "unavailable")
			return
		}
		previous := "draft"
		if err = addHistory(r.Context(), tx, doc.ID, user, "edited", &previous, "draft", strings.TrimSpace(p.Reason), doc.Version); err != nil {
			intakeServerFailure(w, "insert_edited_history", err, "unavailable")
			return
		}
		if err = audit(r.Context(), tx, user, "urmin.surat_masuk.edited", doc.ID); err != nil {
			intakeServerFailure(w, "audit_edited", err, "unavailable")
			return
		}
	}
	var submitted any
	var recipient any
	route := "draft"
	if p.Mode == "submit" {
		previous := "draft"
		doc, err = scanDoc(tx.QueryRow(r.Context(), `UPDATE sdl_urmin_incoming SET status='registered',updated_by=$1,updated_at=now(),version=version+1 WHERE id=$2
 RETURNING id::text,agenda_no,letter_number,sender,letter_date::text,received_date::text,subject,classification,derajat,status,created_by::text,version,created_at,updated_at`, user, doc.ID))
		if err != nil {
			intakeServerFailure(w, "mark_registered", err, "unavailable")
			return
		}
		if err = addHistory(r.Context(), tx, doc.ID, user, "registered", &previous, "registered", strings.TrimSpace(p.Reason), doc.Version); err != nil {
			intakeServerFailure(w, "insert_registered_history", err, "unavailable")
			return
		}
		if err = audit(r.Context(), tx, user, "urmin.surat_masuk.registered", doc.ID); err != nil {
			intakeServerFailure(w, "audit_registered", err, "unavailable")
			return
		}
		submitted = time.Now()
		route = "recorded"
		if p.NeedsDisposition {
			route = "awaiting_kabag"
			recipient = kabag
		}
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO sdl_urmin_incoming_intake(incoming_id,letter_kind,response_due,event_start,event_end,event_location,event_agenda,details,needs_disposition,route_status,kabag_recipient,submitted_at)
 VALUES($1,$2,$3::date,$4::timestamp,$5::timestamp,$6,$7,$8,$9,$10,$11,$12)
 ON CONFLICT(incoming_id) DO UPDATE SET letter_kind=EXCLUDED.letter_kind,response_due=EXCLUDED.response_due,event_start=EXCLUDED.event_start,event_end=EXCLUDED.event_end,event_location=EXCLUDED.event_location,event_agenda=EXCLUDED.event_agenda,details=EXCLUDED.details,needs_disposition=EXCLUDED.needs_disposition,route_status=EXCLUDED.route_status,kabag_recipient=EXCLUDED.kabag_recipient,submitted_at=EXCLUDED.submitted_at,updated_at=now()`, doc.ID, p.LetterKind, dateArg(p.ResponseDue), dateArg(p.EventStart), dateArg(p.EventEnd), strings.TrimSpace(p.EventLocation), strings.TrimSpace(p.EventAgenda), strings.TrimSpace(p.Details), p.NeedsDisposition, route, recipient, submitted)
	if err != nil {
		intakeServerFailure(w, "save_intake_metadata", err, "unavailable")
		return
	}
	// Hash and private object body follow the audited R3B attachment schema.
	for _, f := range files {
		digest := sha256.Sum256(f.body)
		if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_urmin_incoming_attachments(incoming_id,uploaded_by,filename,mime_type,size_bytes,sha256,body,doc_kind)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, doc.ID, user, f.filename, f.mime, len(f.body), hex.EncodeToString(digest[:]), f.body, f.docKind); err != nil {
			intakeServerFailure(w, "insert_attachment", err, "unavailable")
			return
		}
		// This endpoint is atomic; a single audit record represents all attachments.
	}
	if len(files) > 0 {
		if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,'urmin.intake.attachments_submitted','urmin.surat_masuk',$2,jsonb_build_object('count',$3::integer))`, user, doc.ID, len(files)); err != nil {
			intakeServerFailure(w, "audit_attachment_batch", err, "unavailable")
			return
		}
	}
	if kabag != "" {
		// The named Kabag must have current receive permission; re-check before commit.
		valid, e := a.recipientEligible(r.Context(), kabag, "urmin", p.Classification)
		if e != nil || !valid {
			fail(w, 409, "kabagrenmin_not_eligible")
			return
		}
		var distID string
		err = tx.QueryRow(r.Context(), `INSERT INTO sdl_urmin_distributions(incoming_id,sent_by,recipient_unit,recipient_user,reason) VALUES($1,$2,'urmin',$3,$4) RETURNING id::text`, doc.ID, user, kabag, "Surat masuk menunggu arahan Kabagrenmin").Scan(&distID)
		if err != nil {
			intakeServerFailure(w, "insert_distribution", err, "unavailable")
			return
		}
		if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_urmin_distribution_events(distribution_id,actor_id,event_key,reason) VALUES($1,$2,'sent',$3)`, distID, user, "Pengajuan surat masuk memerlukan disposisi"); err != nil {
			intakeServerFailure(w, "insert_distribution_event", err, "unavailable")
			return
		}
		if err = audit(r.Context(), tx, user, "urmin.distribution.sent", distID); err != nil {
			intakeServerFailure(w, "audit_distribution", err, "unavailable")
			return
		}
		// R5F22: enqueue one Kabagrenmin notice in the same atomic intake transaction.
		// Do not enqueue drafts, recorded-only letters or sensitive content.
		if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_urmin_intake_mail_outbox(distribution_id,recipient_user)
		  VALUES($1::uuid,$2::uuid) ON CONFLICT(distribution_id,recipient_user) DO NOTHING`, distID, kabag); err != nil {
			intakeServerFailure(w, "enqueue_intake_email", err, "unavailable")
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		intakeServerFailure(w, "commit_transaction", err, "unavailable")
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]any{"item": doc, "routeStatus": route, "filesSaved": len(files)})
}
func (a *API) intakeRead(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !uuidPattern.MatchString(id) {
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
	ok, err := a.decision(r.Context(), actor(r.Context()), "urmin.surat_masuk.read", doc)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !ok {
		fail(w, 404, "not_found")
		return
	}
	var m intakeMeta
	err = a.DB.QueryRow(r.Context(), `SELECT letter_kind,response_due::text,event_start::text,event_end::text,event_location,event_agenda,details,needs_disposition,route_status,kabag_recipient::text,submitted_at FROM sdl_urmin_incoming_intake WHERE incoming_id=$1`, id).
		Scan(&m.LetterKind, &m.ResponseDue, &m.EventStart, &m.EventEnd, &m.EventLocation, &m.EventAgenda, &m.Details, &m.NeedsDisposition, &m.RouteStatus, &m.KabagRecipient, &m.SubmittedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		jsonResponse(w, 200, map[string]any{"intake": nil})
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	m.WorkflowStatus = m.RouteStatus
	if m.RouteStatus == "awaiting_kabag" && m.KabagRecipient != nil {
		// R5G2 folded what used to be two round trips into one CASE so that the
		// precedence between the branches is stated once, in SQL, instead of
		// being reconstructed by two backends independently.
		//
		// Order is most-advanced-first. An issued arahan outranks a forward:
		// once leadership has answered the letter, whether it was also passed
		// along is no longer what this field is reporting.
		var status string
		err = a.DB.QueryRow(r.Context(), `SELECT CASE
     WHEN EXISTS(SELECT 1 FROM sdl_leadership_directives dir WHERE dir.incoming_id=$1) THEN 'directive_issued'
     WHEN EXISTS(SELECT 1 FROM sdl_urmin_distributions d WHERE d.incoming_id=$1 AND d.sent_by=$2 AND d.recipient_user<>$2) THEN
       (CASE WHEN EXISTS(SELECT 1 FROM sdl_urmin_disposition_tasks t WHERE t.incoming_id=$1 AND t.status<>'completed') THEN 'in_progress'
             WHEN EXISTS(SELECT 1 FROM sdl_urmin_disposition_tasks t WHERE t.incoming_id=$1) THEN 'awaiting_review'
             ELSE 'dispatched' END)
     WHEN EXISTS(SELECT 1 FROM sdl_urmin_distributions d WHERE d.incoming_id=$1 AND d.recipient_user=$2 AND d.status='received') THEN 'read_kabag'
     ELSE 'awaiting_kabag' END`, id, *m.KabagRecipient).Scan(&status)
		if err != nil {
			fail(w, 503, "unavailable")
			return
		}
		m.WorkflowStatus = status
	}
	jsonResponse(w, 200, map[string]any{"intake": m})
}

// The named Kabag must acknowledge before forwarding; informational letters
// cannot be silently promoted to disposition by the old distribution UI.
// Legacy letters retain their original R3B access behaviour.
func (a *API) r5f7DistributionAllowed(ctx context.Context, id, user, class string) (bool, error) {
	var status string
	var leader *string
	err := a.DB.QueryRow(ctx, `SELECT route_status,kabag_recipient::text FROM sdl_urmin_incoming_intake WHERE incoming_id=$1`, id).Scan(&status, &leader)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	if status == "recorded" || status == "draft" {
		return false, nil
	}
	if status != "awaiting_kabag" || leader == nil || *leader != user {
		return false, nil
	}
	current, e := a.kabagForIntake(ctx, class)
	if e != nil || current != user {
		return false, nil
	}
	var received bool
	e = a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_urmin_distributions WHERE incoming_id=$1 AND recipient_user=$2 AND status='received')`, id, user).Scan(&received)
	return received, e
}
