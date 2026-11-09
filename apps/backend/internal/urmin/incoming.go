package urmin

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"siera-delta-lima/backend/internal/access"
)

type API struct{ DB *pgxpool.Pool }
type actorKey struct{}

func WithActor(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, actorKey{}, id)
}
func actor(ctx context.Context) string { s, _ := ctx.Value(actorKey{}).(string); return s }

type Incoming struct {
	ID             string    `json:"id"`
	AgendaNo       int64     `json:"agendaNo"`
	LetterNumber   string    `json:"letterNumber"`
	Sender         string    `json:"sender"`
	LetterDate     string    `json:"letterDate"`
	ReceivedDate   string    `json:"receivedDate"`
	Subject        string    `json:"subject"`
	Classification string    `json:"classification"`
	Derajat        string    `json:"derajat"`
	Status         string    `json:"status"`
	CreatedBy      string    `json:"createdBy"`
	Version        int64     `json:"version"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}
type payload struct {
	LetterNumber   string `json:"letterNumber"`
	Sender         string `json:"sender"`
	LetterDate     string `json:"letterDate"`
	ReceivedDate   string `json:"receivedDate"`
	Subject        string `json:"subject"`
	Classification string `json:"classification"`
	Derajat        string `json:"derajat"`
	Reason         string `json:"reason"`
	Version        int64  `json:"version"`
}
type registerPayload struct {
	Reason  string `json:"reason"`
	Version int64  `json:"version"`
}
type History struct {
	Action     string    `json:"action"`
	FromStatus *string   `json:"fromStatus"`
	ToStatus   string    `json:"toStatus"`
	Reason     string    `json:"reason"`
	Version    int64     `json:"version"`
	Actor      string    `json:"actor"`
	At         time.Time `json:"at"`
}

const selectRecord = `SELECT id::text,agenda_no,letter_number,sender,letter_date::text,received_date::text,subject,classification,derajat,status,created_by::text,version,created_at,updated_at FROM sdl_urmin_incoming`

type scanner interface{ Scan(...any) error }

func scanDoc(r scanner) (Incoming, error) {
	var doc Incoming
	err := r.Scan(&doc.ID, &doc.AgendaNo, &doc.LetterNumber, &doc.Sender, &doc.LetterDate, &doc.ReceivedDate, &doc.Subject, &doc.Classification, &doc.Derajat, &doc.Status, &doc.CreatedBy, &doc.Version, &doc.CreatedAt, &doc.UpdatedAt)
	return doc, err
}
func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func fail(w http.ResponseWriter, status int, code string) {
	jsonResponse(w, status, map[string]string{"error": code})
}
func readJSON(w http.ResponseWriter, r *http.Request, out any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		fail(w, 400, "invalid_body")
		return false
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		fail(w, 400, "invalid_body")
		return false
	}
	return true
}
func validReason(s string) bool { n := len([]rune(strings.TrimSpace(s))); return n >= 8 && n <= 500 }
func validDate(s string) bool {
	t, e := time.Parse("2006-01-02", s)
	return e == nil && t.Format("2006-01-02") == s
}
func validText(s string, min, max int) bool {
	n := len([]rune(strings.TrimSpace(s)))
	return n >= min && n <= max
}
// Derajat kosong diterima dan diperlakukan sebagai "biasa", bukan ditolak 400.
// Alasannya kompatibilitas: field ini baru, dan pemanggil yang belum tahu
// soal derajat tidak boleh mendadak gagal. Nilainya dinormalkan sebelum
// menyentuh SQL karena string kosong melanggar CHECK constraint di 034.
func validDerajat(s string) bool {
	return s == "" || s == "biasa" || s == "kilat"
}
func normalizeDerajat(s string) string {
	if s == "" {
		return "biasa"
	}
	return s
}
func validPayload(p payload) bool {
	return validText(p.LetterNumber, 3, 120) && validText(p.Sender, 3, 240) && validText(p.Subject, 3, 1000) && validDate(p.LetterDate) && validDate(p.ReceivedDate) && validReason(p.Reason) && (p.Classification == "biasa" || p.Classification == "penting") && validDerajat(p.Derajat)
}
func (a *API) decision(ctx context.Context, userID, permission string, doc Incoming) (bool, error) {
	d, e := access.EvaluateForUser(ctx, a.DB, userID, permission, access.Resource{Unit: "urmin", CreatorID: doc.CreatedBy, Classification: doc.Classification, Status: doc.Status}, time.Now())
	return d.Allow, e
}
func (a *API) Routes(r chi.Router) {
	r.Get("/capabilities", a.capabilities)
	r.Get("/", a.list)
	r.Post("/", a.create)
	r.Get("/{id}", a.detail)
	r.Patch("/{id}", a.edit)
	r.Post("/{id}/register", a.register)
	a.R3BRoutes(r)
	a.R5F7Routes(r)
}
func (a *API) capabilities(w http.ResponseWriter, r *http.Request) {
	user := actor(r.Context())
	draft := Incoming{CreatedBy: user, Classification: "biasa", Status: "draft"}
	canCreate, err := a.decision(r.Context(), user, "urmin.surat_masuk.create", draft)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	jsonResponse(w, 200, map[string]bool{"canCreate": canCreate})
}
func (a *API) list(w http.ResponseWriter, r *http.Request) {
	user := actor(r.Context())
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) > 100 {
		fail(w, 400, "invalid_query")
		return
	}
	// Intentionally bounded in R3A. Filters are enforced again per DB-loaded record;
	// R3B will add SQL-level authorization pagination for larger datasets.
	rows, err := a.DB.Query(r.Context(), selectRecord+` WHERE unit_key='urmin' AND ($1='' OR letter_number ILIKE '%'||$1||'%' OR sender ILIKE '%'||$1||'%' OR subject ILIKE '%'||$1||'%') ORDER BY created_at DESC,id DESC LIMIT 200`, q)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	candidates := make([]Incoming, 0)
	for rows.Next() {
		d, e := scanDoc(rows)
		if e != nil {
			rows.Close()
			fail(w, 503, "unavailable")
			return
		}
		candidates = append(candidates, d)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	allowedDocs := make([]Incoming, 0)
	for _, doc := range candidates {
		allowed, err := a.decision(r.Context(), user, "urmin.surat_masuk.read", doc)
		if err != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		if allowed {
			allowedDocs = append(allowedDocs, doc)
		}
	}
	// Metadata is requested only for already-authorized letter IDs.
	workflowStatuses := map[string]string{}
	// Non-nil supaya terserialisasi sebagai {} dan bukan null saat kosong.
	workflowSince := map[string]time.Time{}
	ids := make([]string, 0, len(allowedDocs))
	for _, doc := range allowedDocs {
		ids = append(ids, doc.ID)
	}
	if len(ids) > 0 {
		// R5G2 adds two steps here, but deliberately NOT the task chain that the
		// intake detail computes (r5f7.go). The list has always been the coarser
		// of the two, and widening it would change rows this change never
		// intended to touch.
		rows, e := a.DB.Query(r.Context(), `SELECT i.incoming_id::text,i.route_status,i.kabag_recipient::text,
    CASE WHEN i.kabag_recipient IS NULL THEN false ELSE EXISTS(SELECT 1 FROM sdl_urmin_distributions d WHERE d.incoming_id=i.incoming_id AND d.sent_by=i.kabag_recipient AND d.recipient_user<>i.kabag_recipient) END,
    EXISTS(SELECT 1 FROM sdl_leadership_directives dir WHERE dir.incoming_id=i.incoming_id),
    CASE WHEN i.kabag_recipient IS NULL THEN false ELSE EXISTS(SELECT 1 FROM sdl_urmin_distributions d WHERE d.incoming_id=i.incoming_id AND d.recipient_user=i.kabag_recipient AND d.status='received') END,
    i.submitted_at
    FROM sdl_urmin_incoming_intake i WHERE i.incoming_id=ANY(string_to_array($1,',')::uuid[])`, strings.Join(ids, ","))
		if e != nil {
			fail(w, 503, "unavailable")
			return
		}
		for rows.Next() {
			var id, status string
			var kabag *string
			var forwarded, directed, received bool
			var submitted *time.Time
			if e = rows.Scan(&id, &status, &kabag, &forwarded, &directed, &received, &submitted); e != nil {
				break
			}
			// R5G5: sejak kapan surat ini berada pada keadaan sekarang. Tanpa
			// angka ini, "Menunggu Disposisi Kabagrenmin" tidak bisa dibedakan
			// antara yang baru diajukan tadi pagi dan yang menggantung dua
			// minggu — padahal justru itu yang dicari petugas Urmin.
			if submitted != nil {
				workflowSince[id] = *submitted
			}
			// Precedence, most advanced first. An issued arahan outranks a
			// forward: once leadership has answered the letter, the fact that it
			// was also passed along is no longer what the queue is asking about.
			if status == "awaiting_kabag" {
				switch {
				case directed:
					status = "directive_issued"
				case forwarded:
					status = "dispatched"
				case received:
					status = "read_kabag"
				}
			}
			workflowStatuses[id] = status
		}
		if e == nil {
			e = rows.Err()
		}
		rows.Close()
		if e != nil {
			fail(w, 503, "unavailable")
			return
		}
	}
	jsonResponse(w, 200, map[string]any{"items": allowedDocs, "limited": len(candidates) == 200, "workflowStatuses": workflowStatuses, "workflowSince": workflowSince})
}
func (a *API) load(ctx context.Context, id string) (Incoming, error) {
	return scanDoc(a.DB.QueryRow(ctx, selectRecord+` WHERE id::text=$1`, id))
}
func (a *API) detail(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user := actor(r.Context())
	doc, err := a.load(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	allowed, err := a.decision(r.Context(), user, "urmin.surat_masuk.read", doc)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 404, "not_found")
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT h.action,h.from_status,h.to_status,h.reason,h.version,u.display_name,h.created_at FROM sdl_urmin_incoming_history h JOIN sdl_users u ON u.id=h.actor_id WHERE h.incoming_id=$1 ORDER BY h.version ASC`, id)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	history := make([]History, 0)
	for rows.Next() {
		var h History
		if e := rows.Scan(&h.Action, &h.FromStatus, &h.ToStatus, &h.Reason, &h.Version, &h.Actor, &h.At); e != nil {
			rows.Close()
			fail(w, 503, "unavailable")
			return
		}
		history = append(history, h)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	canEdit, err := a.decision(r.Context(), user, "urmin.surat_masuk.update", doc)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	jsonResponse(w, 200, map[string]any{"item": doc, "history": history, "canEdit": canEdit})
}
func audit(ctx context.Context, tx pgx.Tx, actor, event, id string) error {
	_, err := tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,$2,'urmin.surat_masuk',$3)`, actor, event, id)
	return err
}
func addHistory(ctx context.Context, tx pgx.Tx, id, actor, action string, from *string, to, reason string, version int64) error {
	_, err := tx.Exec(ctx, `INSERT INTO sdl_urmin_incoming_history(incoming_id,actor_id,action,from_status,to_status,reason,version) VALUES($1,$2,$3,$4,$5,$6,$7)`, id, actor, action, from, to, reason, version)
	return err
}
func (a *API) create(w http.ResponseWriter, r *http.Request) {
	var p payload
	if !readJSON(w, r, &p) {
		return
	}
	if !validPayload(p) {
		fail(w, 400, "invalid_input")
		return
	}
	user := actor(r.Context())
	doc := Incoming{CreatedBy: user, Classification: p.Classification, Status: "draft"}
	allowed, err := a.decision(r.Context(), user, "urmin.surat_masuk.create", doc)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 403, "access_denied")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	doc, err = scanDoc(tx.QueryRow(r.Context(), `INSERT INTO sdl_urmin_incoming(letter_number,sender,letter_date,received_date,subject,classification,derajat,created_by,updated_by) VALUES($1,$2,$3::date,$4::date,$5,$6,$7,$8,$8) RETURNING id::text,agenda_no,letter_number,sender,letter_date::text,received_date::text,subject,classification,derajat,status,created_by::text,version,created_at,updated_at`, strings.TrimSpace(p.LetterNumber), strings.TrimSpace(p.Sender), p.LetterDate, p.ReceivedDate, strings.TrimSpace(p.Subject), p.Classification, normalizeDerajat(p.Derajat), user))
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if addHistory(r.Context(), tx, doc.ID, user, "created", nil, "draft", strings.TrimSpace(p.Reason), doc.Version) != nil || audit(r.Context(), tx, user, "urmin.surat_masuk.created", doc.ID) != nil {
		fail(w, 503, "unavailable")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 201, map[string]any{"item": doc})
}
func (a *API) mutating(w http.ResponseWriter, r *http.Request, register bool) {
	id := chi.URLParam(r, "id")
	user := actor(r.Context())
	var p payload
	var change registerPayload
	if register {
		if !readJSON(w, r, &change) {
			return
		}
		if !validReason(change.Reason) || change.Version < 1 {
			fail(w, 400, "invalid_input")
			return
		}
	} else {
		if !readJSON(w, r, &p) {
			return
		}
		if !validPayload(p) || p.Version < 1 {
			fail(w, 400, "invalid_input")
			return
		}
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	doc, err := scanDoc(tx.QueryRow(r.Context(), selectRecord+` WHERE id::text=$1 FOR UPDATE`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	allowed, err := a.decision(r.Context(), user, "urmin.surat_masuk.update", doc)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 404, "not_found")
		return
	}
	version := p.Version
	if register {
		version = change.Version
	}
	if doc.Version != version || doc.Status != "draft" {
		fail(w, 409, "version_or_status_conflict")
		return
	}
	// A R5F7 intake draft must go through the atomic submission workflow.
	// The legacy register endpoint remains for historic R3A drafts only.
	if register {
		var flexible bool
		if e := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_urmin_incoming_intake WHERE incoming_id=$1)`, id).Scan(&flexible); e != nil {
			fail(w, 503, "unavailable")
			return
		}
		if flexible {
			fail(w, 409, "use_intake_submission")
			return
		}
	}
	previous := "draft"
	action := "edited"
	status := "draft"
	reason := p.Reason
	if register {
		action = "registered"
		status = "registered"
		reason = change.Reason
		doc, err = scanDoc(tx.QueryRow(r.Context(), `UPDATE sdl_urmin_incoming SET status='registered',updated_by=$1,updated_at=NOW(),version=version+1 WHERE id::text=$2 RETURNING id::text,agenda_no,letter_number,sender,letter_date::text,received_date::text,subject,classification,derajat,status,created_by::text,version,created_at,updated_at`, user, id))
	} else {
		doc, err = scanDoc(tx.QueryRow(r.Context(), `UPDATE sdl_urmin_incoming SET letter_number=$1,sender=$2,letter_date=$3::date,received_date=$4::date,subject=$5,classification=$6,derajat=$7,updated_by=$8,updated_at=NOW(),version=version+1 WHERE id::text=$9 RETURNING id::text,agenda_no,letter_number,sender,letter_date::text,received_date::text,subject,classification,derajat,status,created_by::text,version,created_at,updated_at`, strings.TrimSpace(p.LetterNumber), strings.TrimSpace(p.Sender), p.LetterDate, p.ReceivedDate, strings.TrimSpace(p.Subject), p.Classification, normalizeDerajat(p.Derajat), user, id))
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if addHistory(r.Context(), tx, doc.ID, user, action, &previous, status, strings.TrimSpace(reason), doc.Version) != nil || audit(r.Context(), tx, user, "urmin.surat_masuk."+action, doc.ID) != nil {
		fail(w, 503, "unavailable")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 200, map[string]any{"item": doc})
}
func (a *API) edit(w http.ResponseWriter, r *http.Request)     { a.mutating(w, r, false) }
func (a *API) register(w http.ResponseWriter, r *http.Request) { a.mutating(w, r, true) }
