package directives

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type API struct{ DB *pgxpool.Pool }

var uuid = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type createRequest struct {
	Title         string     `json:"title"`
	Body          string     `json:"body"`
	Kind          string     `json:"kind"`
	Priority      string     `json:"priority"`
	DueAt         *time.Time `json:"dueAt"`
	Recipients    []string   `json:"recipients"`
	// R5H1: bagian yang ditunjuk, bukan orang.
	// Diterjemahkan menjadi daftar orang di dalam transaksi kirim; lihat
	// sections.go untuk daftar bagian yang sah dan alasan ia hidup di kode.
	Sections      []string `json:"sections"`
	DraftRevision *int64   `json:"draftRevision,omitempty"`
	// R5G2: the incoming letter this directive answers, when it answers one.
	// Optional and nil for 'umum' / 'sprint' / 'lainnya' directives, which do
	// not originate from a letter at all.
	IncomingID *string `json:"incomingId"`
	// R5H2: lembar disposisi, opsional. Lihat sheet.go.
	Sheet *sheet `json:"sheet"`
}
type recipient struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Unit string `json:"unit"`
	// R5H1. omitempty, dan itu bukan kerapian: /candidates memakai struct yang
	// sama dan tidak pernah mengisinya, jadi responsnya tetap byte-identik
	// seperti sebelum R5H1. Kosong juga pada arahan lama dan pada arahan yang
	// dikirim lewat jalur 'recipients' -- di sana penerimanya memang orang,
	// bukan bagian.
	Section        string     `json:"section,omitempty"`
	ReadAt         *time.Time `json:"readAt"`
	AcknowledgedAt *time.Time `json:"acknowledgedAt"`
}
type summary struct {
	ID               string      `json:"id"`
	Title            string      `json:"title"`
	Body             string      `json:"body"`
	Kind             string      `json:"kind"`
	Priority         string      `json:"priority"`
	IssuerID         string      `json:"issuerId"`
	IssuerName       string      `json:"issuerName"`
	DueAt            *time.Time  `json:"dueAt"`
	CreatedAt        time.Time   `json:"createdAt"`
	Total            int         `json:"total"`
	Read             int         `json:"read"`
	Acknowledged     int         `json:"acknowledged"`
	MyReadAt         *time.Time  `json:"myReadAt,omitempty"`
	MyAcknowledgedAt *time.Time  `json:"myAcknowledgedAt,omitempty"`
	Recipients       []recipient `json:"recipients,omitempty"`
	// omitempty: a directive with no source letter serializes exactly as it did
	// before R5G2, so existing recorded responses stay byte-identical.
	IncomingID *string `json:"incomingId,omitempty"`
	// R5H2. omitempty dengan alasan yang sama dengan IncomingID: arahan tanpa
	// lembar diserialisasi persis seperti sebelum 041.
	Sheet *sheet `json:"sheet,omitempty"`
	// R5H5. Nomor surat keluar PERTAMA (menurut created_at) yang merujuk arahan
	// ini lewat fields.rujukanArahanId; ditampilkan sebagai No. Agenda di
	// lembar. Dihitung saat dibaca, hanya oleh detail. omitempty: arahan tanpa
	// surat keluar diserialisasi persis seperti sebelumnya.
	AgendaSurat *string `json:"agendaSurat,omitempty"`
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func deny(w http.ResponseWriter, status int) {
	respond(w, status, map[string]string{"error": map[int]string{400: "invalid_request", 403: "access_denied", 404: "not_found", 409: "conflict", 503: "unavailable"}[status]})
}
func (a *API) Routes(r chi.Router) {
	r.Get("/meta", a.meta)
	r.Get("/candidates", a.candidates)
	r.Get("/sections", a.sectionList)
	r.Get("/letters", a.linkableLetters)
	r.Get("/disposition-options", a.dispositionOptions)
	r.Get("/draft", a.getDraft)
	r.Get("/draft/attachments", a.listDraftFiles)
	r.Post("/draft/attachments", a.uploadDraftFile)
	r.Delete("/draft/attachments/{fileID}", a.deleteDraftFile)
	r.Get("/attachments/{fileID}/download", a.getDirectiveFile)
	r.Put("/draft", a.putDraft)
	r.Delete("/draft", a.deleteDraft)
	r.Get("/inbox", a.inbox)
	r.Get("/sent", a.sent)
	r.Get("/notifications", a.notifications)
	r.Post("/", a.create)
	r.Get("/{id}/attachments", a.listSentFiles)
	r.Get("/{id}", a.detail)
	r.Post("/{id}/read", a.read)
	r.Post("/{id}/acknowledge", a.acknowledge)
	r.Post("/{id}/ack-seen", a.ackSeen)
}
func validText(s string, min, max int) bool {
	return utf8.ValidString(s) && utf8.RuneCountInString(strings.TrimSpace(s)) >= min && utf8.RuneCountInString(s) <= max
}
func uniqueRecipients(ids []string) bool {
	if len(ids) < 1 || len(ids) > 10 {
		return false
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if !uuid.MatchString(id) || seen[strings.ToLower(id)] {
			return false
		}
		seen[strings.ToLower(id)] = true
	}
	return true
}
func uniqueSections(keys []string) bool {
	if len(keys) < 1 || len(keys) > len(sections) {
		return false
	}
	seen := make(map[string]bool, len(keys))
	for _, key := range keys {
		if _, ok := sectionByKey(key); !ok || seen[key] {
			return false
		}
		seen[key] = true
	}
	return true
}

// Dua cara menunjuk penerima, dan tepat satu yang boleh dipakai per pengiriman.
//
// 'sections' adalah jalur R5H1 yang dipakai layar. 'recipients' adalah jalur
// lama; ia tetap hidup karena kontrak API beku selama migrasi Go -> Express,
// bukan karena masih ada yang memanggilnya.
//
// Payload yang memuat KEDUANYA ditolak, bukan digabung. Menggabungkannya
// membuat pertanyaan "arahan ini ditujukan kepada siapa" punya dua jawaban yang
// sama-sama sah, dan dua jawaban itu akan berbeda begitu seorang pemegang
// jabatan juga disebut namanya satu per satu.
func validTargets(p createRequest) bool {
	if len(p.Sections) > 0 {
		return len(p.Recipients) == 0 && uniqueSections(p.Sections)
	}
	return uniqueRecipients(p.Recipients)
}

func validate(p createRequest, now time.Time) bool {
	if !validText(p.Title, 3, 160) || !validText(p.Body, 8, 4000) || !validTargets(p) {
		return false
	}
	switch p.Kind {
	case "umum", "persuratan", "sprint", "lainnya":
	default:
		return false
	}
	switch p.Priority {
	case "biasa", "penting", "kilat":
	default:
		return false
	}
	if p.DueAt != nil && p.DueAt.Before(now) {
		return false
	}
	// Shape only. Whether this actor may link that particular letter is a
	// database question, answered inside the send transaction.
	if p.IncomingID != nil && !uuid.MatchString(*p.IncomingID) {
		return false
	}
	return validSheet(p.Sheet)
}

// Only an active, actual Kabagrenmin grant may issue or monitor all recipients.
// Superadmin never inherits this power, even under development demo mode.
func (a *API) isKabag(ctx context.Context, actor string) (bool, error) {
	var yes bool
	err := a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_users u JOIN sdl_access_grants g ON g.user_id=u.id AND g.role_key='br_kabagrenmin' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW()) JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=g.unit_key JOIN sdl_org_units ou ON ou.unit_key=g.unit_key AND ou.is_active WHERE u.id=$1::uuid AND u.is_active AND NOT u.must_change_password AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sa WHERE sa.user_id=u.id AND sa.role_key='superadmin'))`, actor).Scan(&yes)
	return yes, err
}
// R5G2: a directive may name the incoming letter that prompted it, but only a
// letter that was actually routed to this Kabagrenmin and already accepted by
// them. Those are the same two facts that gate forwarding in
// r5f7DistributionAllowed, so "may I forward this letter" and "may I write its
// arahan" can never disagree.
//
// Letters with no intake row (pre-R5F7) are deliberately NOT linkable. There
// they travel the old distribution path, and there is no recorded recipient to
// check an actor against — accepting them would let any Kabagrenmin claim any
// letter id.
//
// Runs on the send transaction, not the pool: the recipient checks above it
// already do, and a letter accepted between the two reads would otherwise slip
// past a gate that had just refused it.
func letterLinkAllowed(ctx context.Context, tx pgx.Tx, incoming, actor string) (bool, error) {
	var ok bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_urmin_incoming_intake it JOIN sdl_urmin_distributions d ON d.incoming_id=it.incoming_id AND d.recipient_user=$2::uuid AND d.status='received' WHERE it.incoming_id=$1::uuid AND it.kabag_recipient=$2::uuid AND it.route_status='awaiting_kabag')`, incoming, actor).Scan(&ok)
	return ok, err
}

func (a *API) meta(w http.ResponseWriter, r *http.Request) {
	actor := actor(r)
	kab, err := a.isKabag(r.Context(), actor)
	if err != nil {
		deny(w, 503)
		return
	}
	respond(w, 200, map[string]any{"canIssue": kab})
}
func (a *API) candidates(w http.ResponseWriter, r *http.Request) {
	actor := actor(r)
	kab, err := a.isKabag(r.Context(), actor)
	if err != nil {
		deny(w, 503)
		return
	}
	if !kab {
		deny(w, 403)
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT DISTINCT u.id::text,u.display_name,COALESCE((SELECT uu.unit_key FROM sdl_user_units uu WHERE uu.user_id=u.id ORDER BY uu.is_primary DESC,uu.unit_key LIMIT 1),'') FROM sdl_users u JOIN sdl_user_units un ON un.user_id=u.id JOIN sdl_org_units ou ON ou.unit_key=un.unit_key AND ou.is_active JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=un.unit_key AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW()) JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active WHERE u.is_active AND NOT u.must_change_password AND u.id<>$1::uuid AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin') AND NOT EXISTS(SELECT 1 FROM sdl_access_grants leader WHERE leader.user_id=u.id AND leader.role_key='br_kabagrenmin' AND leader.revoked_at IS NULL AND (leader.expires_at IS NULL OR leader.expires_at>NOW())) ORDER BY u.display_name LIMIT 300`, actor)
	if err != nil {
		deny(w, 503)
		return
	}
	defer rows.Close()
	list := make([]recipient, 0)
	for rows.Next() {
		var v recipient
		if rows.Scan(&v.ID, &v.Name, &v.Unit) != nil {
			deny(w, 503)
			return
		}
		list = append(list, v)
	}
	if rows.Err() != nil {
		deny(w, 503)
		return
	}
	respond(w, 200, map[string]any{"items": list})
}
func (a *API) create(w http.ResponseWriter, r *http.Request) {
	actor := actor(r)
	kab, err := a.isKabag(r.Context(), actor)
	if err != nil {
		deny(w, 503)
		return
	}
	if !kab {
		deny(w, 403)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 14000)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var p createRequest
	if dec.Decode(&p) != nil || dec.Decode(new(any)) != io.EOF || !validate(p, time.Now()) {
		deny(w, 400)
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		deny(w, 503)
		return
	}
	defer tx.Rollback(r.Context())
	// Lock and compare the autosaved revision before sending. Older R5F23 clients
	// without a revision retain the legacy delivery behavior.
	if p.DraftRevision != nil {
		if *p.DraftRevision < 1 {
			deny(w, 400)
			return
		}
		var currentRevision int64
		err = tx.QueryRow(r.Context(), `SELECT revision FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid FOR UPDATE`, actor).Scan(&currentRevision)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && currentRevision != *p.DraftRevision) {
			respond(w, 409, map[string]string{"error": "draft_conflict"})
			return
		}
		if err != nil {
			deny(w, 503)
			return
		}
	}
	// R5H1: bagian diterjemahkan menjadi orang DI DALAM transaksi ini, bukan di
	// layar. Jabatan bisa berpindah tangan antara saat daftar bagian dimuat dan
	// saat tombol kirim ditekan; yang tercatat adalah pemegang jabatan saat
	// commit. Bagian kosong ditolak 400 -- sama seperti penerima tidak sah di
	// bawah, karena dari sisi pemanggil artinya sama: payload ini menyebut
	// sesuatu yang tidak bisa dikirimi.
	targets := make([]resolved, 0, len(p.Recipients)+len(p.Sections))
	if len(p.Sections) > 0 {
		targets, err = resolveSections(r.Context(), tx, p.Sections, actor)
		if errors.Is(err, errSectionVacant) {
			deny(w, 400)
			return
		}
		if err != nil {
			deny(w, 503)
			return
		}
	} else {
		for _, id := range p.Recipients {
			targets = append(targets, resolved{UserID: id})
		}
	}
	// Validate all chosen actors in DB in the same transaction, rejecting all on any invalid recipient.
	// Jalur bagian sudah lolos saringan yang lebih ketat di resolveSections;
	// tetap dilewatkan ke sini supaya hanya ada SATU gerbang yang menentukan
	// siapa boleh menjadi penerima arahan, apa pun cara memilihnya.
	for _, t := range targets {
		var ok bool
		err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_users u JOIN sdl_user_units uu ON uu.user_id=u.id JOIN sdl_org_units ou ON ou.unit_key=uu.unit_key AND ou.is_active JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=uu.unit_key AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW()) JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active WHERE u.id=$1::uuid AND u.id<>$2::uuid AND u.is_active AND NOT u.must_change_password AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin') AND NOT EXISTS(SELECT 1 FROM sdl_access_grants gr WHERE gr.user_id=u.id AND gr.role_key='br_kabagrenmin' AND gr.revoked_at IS NULL AND (gr.expires_at IS NULL OR gr.expires_at>NOW())))`, t.UserID, actor).Scan(&ok)
		if err != nil {
			deny(w, 503)
			return
		}
		if !ok {
			deny(w, 400)
			return
		}
	}
	// Rejected as 400, matching the invalid-recipient path above: from the
	// caller's side both mean "this payload names something you may not send to".
	if p.IncomingID != nil {
		linkable, e := letterLinkAllowed(r.Context(), tx, *p.IncomingID, actor)
		if e != nil {
			deny(w, 503)
			return
		}
		if !linkable {
			deny(w, 400)
			return
		}
	}
	p.Sheet = normalizeSheet(p.Sheet)
	sheetOK, err := sheetAllowed(r.Context(), tx, p.Sheet, p.IncomingID, targets)
	if err != nil {
		deny(w, 503)
		return
	}
	if !sheetOK {
		deny(w, 400)
		return
	}
	sheetValue, err := sheetArg(p.Sheet)
	if err != nil {
		deny(w, 503)
		return
	}
	var id string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_leadership_directives(issuer_id,title,body,kind,priority,due_at,incoming_id,sheet) VALUES($1::uuid,$2,$3,$4,$5,$6,$7::uuid,$8::jsonb) RETURNING id::text`, actor, strings.TrimSpace(p.Title), strings.TrimSpace(p.Body), p.Kind, p.Priority, p.DueAt, p.IncomingID, sheetValue).Scan(&id)
	if err != nil {
		deny(w, 503)
		return
	}
	for _, t := range targets {
		// section_key NULL pada jalur 'recipients' -- di sana penerimanya memang
		// orang, dan menuliskan bagian tempat ia kebetulan bekerja akan membuat
		// arahan itu terbaca seolah ditujukan ke bagiannya.
		var sectionArg any
		if t.Section != "" {
			sectionArg = t.Section
		}
		if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_leadership_directive_recipients(directive_id,recipient_id,section_key) VALUES($1::uuid,$2::uuid,$3)`, id, t.UserID, sectionArg); err != nil {
			deny(w, 503)
			return
		}
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_leadership_directive_events(directive_id,actor_id,event_key) VALUES($1::uuid,$2::uuid,'sent')`, id, actor); err != nil {
		deny(w, 503)
		return
	}
	// R5H1: arahan yang menyebut surat sekaligus MENYERAHKAN suratnya.
	//
	// Tanpa baris distribusi, penerima arahan tahu ada surat tapi tidak bisa
	// membukanya: seluruh pembacaan surat masuk disaring di level SQL lewat
	// sdl_urmin_distributions. Baris ini juga yang menghidupkan kembali rantai
	// disposisi ke dalam unit penerima -- sdl_urmin_disposition_tasks.
	// distribution_id NOT NULL, sehingga tanpa distribusi Kasubbag tidak bisa
	// meneruskan apa pun kepada stafnya.
	//
	// Hanya untuk jalur bagian. Jalur 'recipients' tidak punya unit penerima
	// yang bisa dipertanggungjawabkan, dan ia memang tidak pernah membagikan
	// surat sejak R5F23.
	if p.IncomingID != nil && len(p.Sections) > 0 {
		if !a.handOverLetter(w, r, tx, *p.IncomingID, actor, strings.TrimSpace(p.Title), targets) {
			return
		}
	}
	if p.DraftRevision != nil {
		// Move each private draft upload to this newly sent directive, in the
		// same transaction as the recipients and irreversible send action.
		if _, err = tx.Exec(r.Context(), `UPDATE sdl_leadership_directive_files SET directive_id=$1::uuid WHERE issuer_id=$2::uuid AND directive_id IS NULL`, id, actor); err != nil {
			deny(w, 503)
			return
		}
		if _, err = tx.Exec(r.Context(), `DELETE FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid AND revision=$2`, actor, *p.DraftRevision); err != nil {
			deny(w, 503)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		deny(w, 503)
		return
	}
	respond(w, 201, map[string]string{"id": id})
}

const listSQL = `SELECT d.id::text,d.title,d.body,d.kind,d.priority,d.issuer_id::text,u.display_name,d.due_at,d.created_at,(SELECT COUNT(*) FROM sdl_leadership_directive_recipients x WHERE x.directive_id=d.id)::int,(SELECT COUNT(*) FROM sdl_leadership_directive_recipients x WHERE x.directive_id=d.id AND x.read_at IS NOT NULL)::int,(SELECT COUNT(*) FROM sdl_leadership_directive_recipients x WHERE x.directive_id=d.id AND x.acknowledged_at IS NOT NULL)::int,d.incoming_id::text,d.sheet FROM sdl_leadership_directives d JOIN sdl_users u ON u.id=d.issuer_id`

func scan(s interface{ Scan(...any) error }) (summary, error) {
	var v summary
	var rawSheet []byte
	err := s.Scan(&v.ID, &v.Title, &v.Body, &v.Kind, &v.Priority, &v.IssuerID, &v.IssuerName, &v.DueAt, &v.CreatedAt, &v.Total, &v.Read, &v.Acknowledged, &v.IncomingID, &rawSheet)
	if err != nil {
		return v, err
	}
	v.Sheet, err = decodeSheet(rawSheet)
	return v, err
}
func (a *API) inbox(w http.ResponseWriter, r *http.Request) {
	actor := actor(r)
	rows, err := a.DB.Query(r.Context(), listSQL+` WHERE EXISTS(SELECT 1 FROM sdl_leadership_directive_recipients rr WHERE rr.directive_id=d.id AND rr.recipient_id=$1::uuid) ORDER BY d.created_at DESC LIMIT 150`, actor)
	if err != nil {
		deny(w, 503)
		return
	}
	defer rows.Close()
	items := make([]summary, 0)
	for rows.Next() {
		v, e := scan(rows)
		if e != nil {
			deny(w, 503)
			return
		}
		items = append(items, v)
	}
	if rows.Err() != nil {
		deny(w, 503)
		return
	}
	// Load only the requesting recipient's read / acknowledgement timestamps.
	rows.Close()
	statuses, e := a.DB.Query(r.Context(), `SELECT directive_id::text,read_at,acknowledged_at FROM sdl_leadership_directive_recipients WHERE recipient_id=$1::uuid ORDER BY directive_id`, actor)
	if e != nil {
		deny(w, 503)
		return
	}
	mine := map[string][2]*time.Time{}
	for statuses.Next() {
		var id string
		var read, ack *time.Time
		if statuses.Scan(&id, &read, &ack) != nil {
			statuses.Close()
			deny(w, 503)
			return
		}
		mine[id] = [2]*time.Time{read, ack}
	}
	if statuses.Err() != nil {
		statuses.Close()
		deny(w, 503)
		return
	}
	statuses.Close()
	for i := range items {
		if v, ok := mine[items[i].ID]; ok {
			items[i].MyReadAt = v[0]
			items[i].MyAcknowledgedAt = v[1]
		}
	}
	respond(w, 200, map[string]any{"items": items})
}
func (a *API) sent(w http.ResponseWriter, r *http.Request) {
	actor := actor(r)
	kab, err := a.isKabag(r.Context(), actor)
	if err != nil {
		deny(w, 503)
		return
	}
	if !kab {
		deny(w, 403)
		return
	}
	rows, err := a.DB.Query(r.Context(), listSQL+` WHERE d.issuer_id=$1::uuid ORDER BY d.created_at DESC LIMIT 150`, actor)
	if err != nil {
		deny(w, 503)
		return
	}
	defer rows.Close()
	items := make([]summary, 0)
	for rows.Next() {
		v, e := scan(rows)
		if e != nil {
			deny(w, 503)
			return
		}
		items = append(items, v)
	}
	if rows.Err() != nil {
		deny(w, 503)
		return
	}
	respond(w, 200, map[string]any{"items": items})
}
func (a *API) notifications(w http.ResponseWriter, r *http.Request) {
	actor := actor(r)
	var unread, ackUnseen int
	err := a.DB.QueryRow(r.Context(), `SELECT COUNT(*)::int FROM sdl_leadership_directive_recipients WHERE recipient_id=$1::uuid AND read_at IS NULL`, actor).Scan(&unread)
	if err != nil {
		deny(w, 503)
		return
	}
	kab, err := a.isKabag(r.Context(), actor)
	if err != nil {
		deny(w, 503)
		return
	}
	if kab {
		err = a.DB.QueryRow(r.Context(), `SELECT COUNT(*)::int FROM sdl_leadership_directive_recipients rr JOIN sdl_leadership_directives d ON d.id=rr.directive_id WHERE d.issuer_id=$1::uuid AND rr.acknowledged_at IS NOT NULL AND rr.issuer_seen_at IS NULL`, actor).Scan(&ackUnseen)
		if err != nil {
			deny(w, 503)
			return
		}
	}
	respond(w, 200, map[string]any{"unread": unread, "newAcknowledgements": ackUnseen, "total": unread + ackUnseen, "canIssue": kab})
}
// R5H5: surat keluar yang terhapus (deleted_at) tidak dihitung, sehingga
// begitu draf pertama dihapus, surat berikutnya yang menggantikannya.
const agendaSuratSQL = `SELECT r.fields->>'nomorSurat' FROM sdl_urmin_registry r
 WHERE r.kind='surat_keluar' AND r.deleted_at IS NULL
   AND r.fields->>'rujukanArahanId'=$1 AND COALESCE(r.fields->>'nomorSurat','')<>''
 ORDER BY r.created_at,r.id LIMIT 1`

func (a *API) detail(w http.ResponseWriter, r *http.Request) {
	actor := actor(r)
	id := chi.URLParam(r, "id")
	if !uuid.MatchString(id) {
		deny(w, 404)
		return
	}
	kab, err := a.isKabag(r.Context(), actor)
	if err != nil {
		deny(w, 503)
		return
	}
	q := listSQL + ` WHERE d.id=$1::uuid AND (EXISTS(SELECT 1 FROM sdl_leadership_directive_recipients rr WHERE rr.directive_id=d.id AND rr.recipient_id=$2::uuid) OR (d.issuer_id=$2::uuid AND $3::boolean))`
	v, err := scan(a.DB.QueryRow(r.Context(), q, id, actor, kab))
	if errors.Is(err, pgx.ErrNoRows) {
		deny(w, 404)
		return
	}
	if err != nil {
		deny(w, 503)
		return
	}
	var mine *time.Time
	var ack *time.Time
	var exists bool
	err = a.DB.QueryRow(r.Context(), `SELECT read_at,acknowledged_at FROM sdl_leadership_directive_recipients WHERE directive_id=$1::uuid AND recipient_id=$2::uuid`, id, actor).Scan(&mine, &ack)
	if errors.Is(err, pgx.ErrNoRows) {
		exists = false
	} else if err != nil {
		deny(w, 503)
		return
	} else {
		exists = true
	}
	if exists {
		v.MyReadAt = mine
		v.MyAcknowledgedAt = ack
	}
	var agenda string
	err = a.DB.QueryRow(r.Context(), agendaSuratSQL, id).Scan(&agenda)
	if err == nil {
		v.AgendaSurat = &agenda
	} else if !errors.Is(err, pgx.ErrNoRows) {
		deny(w, 503)
		return
	}
	if kab && v.IssuerID == actor {
		rows, e := a.DB.Query(r.Context(), `SELECT rr.recipient_id::text,u.display_name,COALESCE((SELECT uu.unit_key FROM sdl_user_units uu WHERE uu.user_id=u.id ORDER BY uu.is_primary DESC,uu.unit_key LIMIT 1),''),COALESCE(rr.section_key,''),rr.read_at,rr.acknowledged_at FROM sdl_leadership_directive_recipients rr JOIN sdl_users u ON u.id=rr.recipient_id WHERE rr.directive_id=$1::uuid ORDER BY u.display_name`, id)
		if e != nil {
			deny(w, 503)
			return
		}
		defer rows.Close()
		v.Recipients = make([]recipient, 0)
		for rows.Next() {
			var x recipient
			if rows.Scan(&x.ID, &x.Name, &x.Unit, &x.Section, &x.ReadAt, &x.AcknowledgedAt) != nil {
				deny(w, 503)
				return
			}
			v.Recipients = append(v.Recipients, x)
		}
		if rows.Err() != nil {
			deny(w, 503)
			return
		}
	}
	respond(w, 200, v)
}
func (a *API) event(w http.ResponseWriter, r *http.Request, kind string) {
	actor := actor(r)
	id := chi.URLParam(r, "id")
	if !uuid.MatchString(id) {
		deny(w, 404)
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		deny(w, 503)
		return
	}
	defer tx.Rollback(r.Context())
	var found bool
	// Only assigned recipient may mark read / acknowledge. Monotonic transitions prevent status regressions.
	err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_leadership_directive_recipients WHERE directive_id=$1::uuid AND recipient_id=$2::uuid)`, id, actor).Scan(&found)
	if err != nil {
		deny(w, 503)
		return
	}
	if !found {
		deny(w, 404)
		return
	}
	var changed bool
	if kind == "read" {
		err = tx.QueryRow(r.Context(), `WITH changed AS (UPDATE sdl_leadership_directive_recipients SET read_at=NOW() WHERE directive_id=$1::uuid AND recipient_id=$2::uuid AND read_at IS NULL RETURNING 1) SELECT EXISTS(SELECT 1 FROM changed)`, id, actor).Scan(&changed)
	} else {
		err = tx.QueryRow(r.Context(), `WITH changed AS (UPDATE sdl_leadership_directive_recipients SET read_at=COALESCE(read_at,NOW()),acknowledged_at=NOW() WHERE directive_id=$1::uuid AND recipient_id=$2::uuid AND acknowledged_at IS NULL RETURNING 1) SELECT EXISTS(SELECT 1 FROM changed)`, id, actor).Scan(&changed)
	}
	if err != nil {
		deny(w, 503)
		return
	}
	if changed {
		if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_leadership_directive_events(directive_id,actor_id,recipient_id,event_key) VALUES($1::uuid,$2::uuid,$2::uuid,$3)`, id, actor, kind); err != nil {
			deny(w, 503)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		deny(w, 503)
		return
	}
	respond(w, 200, map[string]any{"updated": changed})
}
func (a *API) read(w http.ResponseWriter, r *http.Request)        { a.event(w, r, "read") }
func (a *API) acknowledge(w http.ResponseWriter, r *http.Request) { a.event(w, r, "acknowledged") }
func (a *API) ackSeen(w http.ResponseWriter, r *http.Request) {
	actor := actor(r)
	id := chi.URLParam(r, "id")
	if !uuid.MatchString(id) {
		deny(w, 404)
		return
	}
	kab, err := a.isKabag(r.Context(), actor)
	if err != nil {
		deny(w, 503)
		return
	}
	if !kab {
		deny(w, 403)
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		deny(w, 503)
		return
	}
	defer tx.Rollback(r.Context())
	tag, err := tx.Exec(r.Context(), `UPDATE sdl_leadership_directive_recipients rr SET issuer_seen_at=NOW() FROM sdl_leadership_directives d WHERE rr.directive_id=d.id AND d.id=$1::uuid AND d.issuer_id=$2::uuid AND rr.acknowledged_at IS NOT NULL AND rr.issuer_seen_at IS NULL`, id, actor)
	if err != nil {
		deny(w, 503)
		return
	}
	if tag.RowsAffected() > 0 {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_leadership_directive_events(directive_id,actor_id,event_key) VALUES($1::uuid,$2::uuid,'ack_seen')`, id, actor)
		if err != nil {
			deny(w, 503)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		deny(w, 503)
		return
	}
	respond(w, 200, map[string]any{"updated": tag.RowsAffected() > 0})
}
