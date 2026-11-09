package subbagren

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"siera-delta-lima/backend/internal/access"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type API struct {
	DB          *pgxpool.Pool
	EvidenceKey []byte
}
type actorContextKey struct{}

func WithActor(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, actorContextKey{}, userID)
}
func actor(ctx context.Context) string { id, _ := ctx.Value(actorContextKey{}).(string); return id }

type Proposal struct {
	ID             string    `json:"id"`
	Number         int64     `json:"number"`
	FiscalYear     int       `json:"fiscalYear"`
	SourceUnit     string    `json:"sourceUnit"`
	Title          string    `json:"title"`
	OutputTarget   string    `json:"outputTarget"`
	ProposedBudget int64     `json:"proposedBudget"`
	Classification string    `json:"classification"`
	Status         string    `json:"status"`
	ReviewStatus   string    `json:"reviewStatus"`
	RevisionCount  int       `json:"revisionCount"`
	CreatedBy      string    `json:"createdBy"`
	Version        int64     `json:"version"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}
type Draft struct {
	FiscalYear     int    `json:"fiscalYear"`
	SourceUnit     string `json:"sourceUnit"`
	Title          string `json:"title"`
	OutputTarget   string `json:"outputTarget"`
	ProposedBudget int64  `json:"proposedBudget"`
	Classification string `json:"classification"`
	Reason         string `json:"reason"`
	Version        int64  `json:"version"`
}
type actionRequest struct {
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
type scanner interface{ Scan(...any) error }

const columns = `SELECT id::text,number,fiscal_year,source_unit,title,output_target,proposed_budget,classification,status,created_by::text,version,created_at,updated_at FROM sdl_subbagren_proposals`

func scan(row scanner) (Proposal, error) {
	var p Proposal
	err := row.Scan(&p.ID, &p.Number, &p.FiscalYear, &p.SourceUnit, &p.Title, &p.OutputTarget, &p.ProposedBudget, &p.Classification, &p.Status, &p.CreatedBy, &p.Version, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func reject(w http.ResponseWriter, status int, code string) {
	respond(w, status, map[string]string{"error": code})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if dec.Decode(v) != nil {
		reject(w, 400, "invalid_body")
		return false
	}
	var tail any
	if dec.Decode(&tail) != io.EOF {
		reject(w, 400, "invalid_body")
		return false
	}
	return true
}
func textOK(s string, min, max int) bool {
	n := len([]rune(strings.TrimSpace(s)))
	return n >= min && n <= max
}
func validReason(s string) bool { return textOK(s, 8, 500) }
func validDraft(p Draft) bool {
	return p.FiscalYear >= 2020 && p.FiscalYear <= 2100 && textOK(p.SourceUnit, 3, 160) && textOK(p.Title, 5, 300) && textOK(p.OutputTarget, 5, 600) && p.ProposedBudget >= 0 && p.ProposedBudget <= 1000000000000000 && (p.Classification == "biasa" || p.Classification == "penting") && validReason(p.Reason)
}
func (a *API) permitted(ctx context.Context, user, permission string, p Proposal) (bool, error) {
	decision, err := access.EvaluateForUser(ctx, a.DB, user, permission, access.Resource{Unit: "subbagren", CreatorID: p.CreatedBy, Classification: p.Classification, Status: p.Status}, time.Now().UTC())
	return decision.Allow, err
}
func (a *API) Routes(r chi.Router) {
	r.Get("/capabilities", a.capabilities)
	r.Get("/", a.list)
	r.Post("/", a.create)
	r.Get("/{id}", a.detail)
	r.Patch("/{id}", a.update)
	r.Post("/{id}/submit", a.submit)
	r.Post("/{id}/review", a.review)
	r.Patch("/{id}/revision", a.revision)
	r.Post("/{id}/resubmit", a.resubmit)
	r.Get("/consolidation", a.consolidation)
}
func (a *API) capabilities(w http.ResponseWriter, r *http.Request) {
	user := actor(r.Context())
	candidate := Proposal{CreatedBy: user, Classification: "biasa", Status: "draft"}
	ok, err := a.permitted(r.Context(), user, "subbagren.usulan.create", candidate)
	if err != nil {
		reject(w, 503, "authorization_unavailable")
		return
	}
	consolidate, e := a.permitted(r.Context(), user, "subbagren.usulan.consolidate", candidate)
	if e != nil {
		reject(w, 503, "authorization_unavailable")
		return
	}
	respond(w, 200, map[string]bool{"canCreate": ok, "canConsolidate": consolidate})
}
func (a *API) list(w http.ResponseWriter, r *http.Request) {
	user := actor(r.Context())
	rows, err := a.DB.Query(r.Context(), columns+` ORDER BY created_at DESC,id DESC LIMIT 151`)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	candidates := []Proposal{}
	for rows.Next() {
		p, e := scan(rows)
		if e != nil {
			err = e
			break
		}
		candidates = append(candidates, p)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	results := []Proposal{}
	for _, p := range candidates {
		allowed, e := a.permitted(r.Context(), user, "subbagren.usulan.read", p)
		if e != nil {
			reject(w, 503, "authorization_unavailable")
			return
		}
		if allowed && len(results) < 150 {
			if e := a.decorateReview(r.Context(), &p); e != nil {
				reject(w, 503, "unavailable")
				return
			}
			results = append(results, p)
		}
	}
	respond(w, 200, map[string]any{"items": results, "limited": len(candidates) == 151})
}
func (a *API) detail(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := scan(a.DB.QueryRow(r.Context(), columns+` WHERE id::text=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "not_found")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	user := actor(r.Context())
	ok, err := a.permitted(r.Context(), user, "subbagren.usulan.read", p)
	if err != nil {
		reject(w, 503, "authorization_unavailable")
		return
	}
	if !ok {
		reject(w, 404, "not_found")
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT h.action,h.from_status,h.to_status,h.reason,h.version,u.display_name,h.created_at FROM sdl_subbagren_proposal_history h JOIN sdl_users u ON u.id=h.actor_id WHERE h.proposal_id=$1 ORDER BY h.version`, id)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	history := []History{}
	for rows.Next() {
		var h History
		if e := rows.Scan(&h.Action, &h.FromStatus, &h.ToStatus, &h.Reason, &h.Version, &h.Actor, &h.At); e != nil {
			err = e
			break
		}
		history = append(history, h)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if err := a.decorateReview(r.Context(), &p); err != nil {
		reject(w, 503, "unavailable")
		return
	}
	canUpdate, err := a.permitted(r.Context(), user, "subbagren.usulan.update", p)
	if err != nil {
		reject(w, 503, "authorization_unavailable")
		return
	}
	canSubmit, err := a.permitted(r.Context(), user, "subbagren.usulan.submit", p)
	if err != nil {
		reject(w, 503, "authorization_unavailable")
		return
	}
	canRevise, canResubmit, canReview, err := a.detailActions(r.Context(), user, p)
	if err != nil {
		reject(w, 503, "authorization_unavailable")
		return
	}
	reviewHistory, err := a.reviewHistory(r.Context(), p.ID)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"item": p, "history": history, "reviewHistory": reviewHistory, "canUpdate": canUpdate && p.Status == "draft", "canSubmit": canSubmit && p.Status == "draft", "canRevise": canRevise, "canResubmit": canResubmit, "canReview": canReview})
}
func logAction(ctx context.Context, tx pgx.Tx, user string, p Proposal, action, reason string, from *string) error {
	if _, err := tx.Exec(ctx, `INSERT INTO sdl_subbagren_proposal_history(proposal_id,actor_id,action,from_status,to_status,reason,version) VALUES($1,$2,$3,$4,$5,$6,$7)`, p.ID, user, action, from, p.Status, strings.TrimSpace(reason), p.Version); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,$2,'subbagren.usulan',$3)`, user, "subbagren.usulan."+action, p.ID)
	return err
}
func (a *API) create(w http.ResponseWriter, r *http.Request) {
	var d Draft
	if !decode(w, r, &d) {
		return
	}
	if !validDraft(d) {
		reject(w, 400, "invalid_input")
		return
	}
	user := actor(r.Context())
	ok, err := a.permitted(r.Context(), user, "subbagren.usulan.create", Proposal{CreatedBy: user, Classification: d.Classification, Status: "draft"})
	if err != nil {
		reject(w, 503, "authorization_unavailable")
		return
	}
	if !ok {
		reject(w, 403, "access_denied")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	p, err := scan(tx.QueryRow(r.Context(), `INSERT INTO sdl_subbagren_proposals(fiscal_year,source_unit,title,output_target,proposed_budget,classification,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id::text,number,fiscal_year,source_unit,title,output_target,proposed_budget,classification,status,created_by::text,version,created_at,updated_at`, d.FiscalYear, strings.TrimSpace(d.SourceUnit), strings.TrimSpace(d.Title), strings.TrimSpace(d.OutputTarget), d.ProposedBudget, d.Classification, user))
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if logAction(r.Context(), tx, user, p, "created", d.Reason, nil) != nil || tx.Commit(r.Context()) != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 201, map[string]any{"item": p})
}
func (a *API) mutate(w http.ResponseWriter, r *http.Request, submit bool) {
	id := chi.URLParam(r, "id")
	user := actor(r.Context())
	var d Draft
	var action actionRequest
	if submit {
		if !decode(w, r, &action) {
			return
		}
		if !validReason(action.Reason) || action.Version < 1 {
			reject(w, 400, "invalid_input")
			return
		}
	}
	if !submit {
		if !decode(w, r, &d) {
			return
		}
		if !validDraft(d) || d.Version < 1 {
			reject(w, 400, "invalid_input")
			return
		}
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	p, err := scan(tx.QueryRow(r.Context(), columns+` WHERE id::text=$1 FOR UPDATE`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "not_found")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	perm := "subbagren.usulan.update"
	version := d.Version
	if submit {
		perm = "subbagren.usulan.submit"
		version = action.Version
	}
	ok, err := a.permitted(r.Context(), user, perm, p)
	if err != nil {
		reject(w, 503, "authorization_unavailable")
		return
	}
	if !ok {
		reject(w, 404, "not_found")
		return
	}
	if p.Status != "draft" || p.Version != version {
		reject(w, 409, "version_or_status_conflict")
		return
	}
	var reason, verb string
	old := "draft"
	if submit {
		reason = action.Reason
		verb = "submitted"
		p, err = scan(tx.QueryRow(r.Context(), `UPDATE sdl_subbagren_proposals SET status='submitted',updated_by=$1,updated_at=now(),version=version+1 WHERE id=$2 RETURNING id::text,number,fiscal_year,source_unit,title,output_target,proposed_budget,classification,status,created_by::text,version,created_at,updated_at`, user, id))
	} else {
		// Editing classification to 'penting' requires authorization for the NEW class too.
		ok, err = a.permitted(r.Context(), user, perm, Proposal{CreatedBy: p.CreatedBy, Classification: d.Classification, Status: "draft"})
		if err != nil {
			reject(w, 503, "authorization_unavailable")
			return
		}
		if !ok {
			reject(w, 403, "access_denied")
			return
		}
		reason = d.Reason
		verb = "updated"
		p, err = scan(tx.QueryRow(r.Context(), `UPDATE sdl_subbagren_proposals SET fiscal_year=$1,source_unit=$2,title=$3,output_target=$4,proposed_budget=$5,classification=$6,updated_by=$7,updated_at=now(),version=version+1 WHERE id=$8 RETURNING id::text,number,fiscal_year,source_unit,title,output_target,proposed_budget,classification,status,created_by::text,version,created_at,updated_at`, d.FiscalYear, strings.TrimSpace(d.SourceUnit), strings.TrimSpace(d.Title), strings.TrimSpace(d.OutputTarget), d.ProposedBudget, d.Classification, user, id))
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if logAction(r.Context(), tx, user, p, verb, reason, &old) != nil || tx.Commit(r.Context()) != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"item": p})
}
func (a *API) update(w http.ResponseWriter, r *http.Request) { a.mutate(w, r, false) }
func (a *API) submit(w http.ResponseWriter, r *http.Request) { a.mutate(w, r, true) }
