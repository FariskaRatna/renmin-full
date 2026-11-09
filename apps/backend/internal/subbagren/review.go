package subbagren

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type reviewCase struct {
	Status        string
	RevisionCount int
	HasRevision   bool
}
type reviewEvent struct {
	Action  string    `json:"action"`
	Reason  string    `json:"reason"`
	Actor   string    `json:"actor"`
	Version int64     `json:"version"`
	At      time.Time `json:"at"`
}

func (a *API) getReviewCase(ctx context.Context, id string) (reviewCase, error) {
	var c reviewCase
	err := a.DB.QueryRow(ctx, `SELECT review_status,revision_count,has_revision FROM sdl_subbagren_review_cases WHERE proposal_id=$1`, id).Scan(&c.Status, &c.RevisionCount, &c.HasRevision)
	if errors.Is(err, pgx.ErrNoRows) {
		return reviewCase{Status: "pending"}, nil
	}
	return c, err
}
func (a *API) decorateReview(ctx context.Context, p *Proposal) error {
	if p.Status == "draft" {
		p.ReviewStatus = "draft"
		return nil
	}
	c, err := a.getReviewCase(ctx, p.ID)
	if err != nil {
		return err
	}
	p.ReviewStatus = c.Status
	p.RevisionCount = c.RevisionCount
	return nil
}
func (a *API) detailActions(ctx context.Context, user string, p Proposal) (bool, bool, bool, error) {
	if p.Status != "submitted" {
		return false, false, false, nil
	}
	revise := p.ReviewStatus == "revision_requested" && user == p.CreatedBy
	resubmit := revise
	review := p.ReviewStatus == "pending" && user != p.CreatedBy
	if revise {
		// The update permission checks against a server-derived editable state.
		candidate := p
		candidate.Status = "draft"
		ok, err := a.permitted(ctx, user, "subbagren.usulan.update", candidate)
		if err != nil {
			return false, false, false, err
		}
		revise = ok
		ok, err = a.permitted(ctx, user, "subbagren.usulan.submit", candidate)
		if err != nil {
			return false, false, false, err
		}
		resubmit = ok && p.RevisionCount < 100 // actual revision flag checked below
		c, err := a.getReviewCase(ctx, p.ID)
		if err != nil {
			return false, false, false, err
		}
		resubmit = resubmit && c.HasRevision
	}
	if review {
		ok, err := a.permitted(ctx, user, "subbagren.usulan.review", p)
		if err != nil {
			return false, false, false, err
		}
		review = ok
	}
	return revise, resubmit, review, nil
}
func (a *API) reviewHistory(ctx context.Context, id string) ([]reviewEvent, error) {
	rows, err := a.DB.Query(ctx, `SELECT e.action,e.reason,u.display_name,e.proposal_version,e.created_at FROM sdl_subbagren_review_events e JOIN sdl_users u ON u.id=e.actor_id WHERE e.proposal_id=$1 ORDER BY e.proposal_version`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []reviewEvent{}
	for rows.Next() {
		var e reviewEvent
		if err = rows.Scan(&e.Action, &e.Reason, &e.Actor, &e.Version, &e.At); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}
func (a *API) loadForUpdate(ctx context.Context, tx pgx.Tx, id string) (Proposal, error) {
	return scan(tx.QueryRow(ctx, columns+` WHERE id::text=$1 FOR UPDATE`, id))
}
func caseForUpdate(ctx context.Context, tx pgx.Tx, id string) (reviewCase, error) {
	var c reviewCase
	err := tx.QueryRow(ctx, `SELECT review_status,revision_count,has_revision FROM sdl_subbagren_review_cases WHERE proposal_id=$1 FOR UPDATE`, id).Scan(&c.Status, &c.RevisionCount, &c.HasRevision)
	if errors.Is(err, pgx.ErrNoRows) {
		return reviewCase{Status: "pending"}, nil
	}
	return c, err
}
func reviewLog(ctx context.Context, tx pgx.Tx, user string, p Proposal, action, reason string) error {
	_, err := tx.Exec(ctx, `INSERT INTO sdl_subbagren_review_events(proposal_id,actor_id,action,reason,proposal_version) VALUES($1,$2,$3,$4,$5)`, p.ID, user, action, strings.TrimSpace(reason), p.Version)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,$2,'subbagren.usulan',$3)`, user, "subbagren.usulan."+action, p.ID)
	return err
}
func (a *API) authorize(w http.ResponseWriter, ctx context.Context, user, permission string, p Proposal) bool {
	ok, err := a.permitted(ctx, user, "subbagren.usulan.read", p)
	if err != nil {
		reject(w, 503, "authorization_unavailable")
		return false
	}
	if !ok {
		reject(w, 404, "not_found")
		return false
	}
	ok, err = a.permitted(ctx, user, permission, p)
	if err != nil {
		reject(w, 503, "authorization_unavailable")
		return false
	}
	if !ok {
		reject(w, 404, "not_found")
		return false
	}
	return true
}

type reviewRequest struct {
	Version  int64  `json:"version"`
	Decision string `json:"decision"`
	Reason   string `json:"reason"`
}

func (a *API) review(w http.ResponseWriter, r *http.Request) {
	var input reviewRequest
	if !decode(w, r, &input) {
		return
	}
	if input.Version < 1 || !validReason(input.Reason) || (input.Decision != "approved" && input.Decision != "revision_requested") {
		reject(w, 400, "invalid_input")
		return
	}
	id, user := chi.URLParam(r, "id"), actor(r.Context())
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	p, err := a.loadForUpdate(r.Context(), tx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "not_found")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if !a.authorize(w, r.Context(), user, "subbagren.usulan.review", p) {
		return
	}
	if p.CreatedBy == user {
		reject(w, 403, "self_review_denied")
		return
	}
	if p.Version != input.Version || p.Status != "submitted" {
		reject(w, 409, "version_or_status_conflict")
		return
	}
	c, err := caseForUpdate(r.Context(), tx, id)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if c.Status != "pending" {
		reject(w, 409, "review_already_decided")
		return
	}
	p, err = scan(tx.QueryRow(r.Context(), `UPDATE sdl_subbagren_proposals SET updated_by=$1,updated_at=now(),version=version+1 WHERE id=$2 RETURNING id::text,number,fiscal_year,source_unit,title,output_target,proposed_budget,classification,status,created_by::text,version,created_at,updated_at`, user, id))
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO sdl_subbagren_review_cases(proposal_id,review_status,revision_count,has_revision,updated_by) VALUES($1,$2,$3,false,$4) ON CONFLICT(proposal_id) DO UPDATE SET review_status=EXCLUDED.review_status,has_revision=false,updated_by=EXCLUDED.updated_by,updated_at=now()`, id, input.Decision, c.RevisionCount, user)
	if err != nil || reviewLog(r.Context(), tx, user, p, input.Decision, input.Reason) != nil || tx.Commit(r.Context()) != nil {
		reject(w, 503, "unavailable")
		return
	}
	p.ReviewStatus = input.Decision
	p.RevisionCount = c.RevisionCount
	respond(w, 200, map[string]any{"item": p})
}
func (a *API) revision(w http.ResponseWriter, r *http.Request) {
	var d Draft
	if !decode(w, r, &d) {
		return
	}
	if !validDraft(d) || d.Version < 1 {
		reject(w, 400, "invalid_input")
		return
	}
	id, user := chi.URLParam(r, "id"), actor(r.Context())
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	p, err := a.loadForUpdate(r.Context(), tx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "not_found")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if p.CreatedBy != user {
		reject(w, 404, "not_found")
		return
	}
	candidate := p
	candidate.Status = "draft"
	if !a.authorize(w, r.Context(), user, "subbagren.usulan.update", candidate) {
		return
	}
	// Reclassification must be permitted at the NEW classification too.
	candidate.Classification = d.Classification
	ok, err := a.permitted(r.Context(), user, "subbagren.usulan.update", candidate)
	if err != nil {
		reject(w, 503, "authorization_unavailable")
		return
	}
	if !ok {
		reject(w, 403, "access_denied")
		return
	}
	c, err := caseForUpdate(r.Context(), tx, id)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if p.Status != "submitted" || c.Status != "revision_requested" || p.Version != d.Version {
		reject(w, 409, "version_or_status_conflict")
		return
	}
	p, err = scan(tx.QueryRow(r.Context(), `UPDATE sdl_subbagren_proposals SET fiscal_year=$1,source_unit=$2,title=$3,output_target=$4,proposed_budget=$5,classification=$6,updated_by=$7,updated_at=now(),version=version+1 WHERE id=$8 RETURNING id::text,number,fiscal_year,source_unit,title,output_target,proposed_budget,classification,status,created_by::text,version,created_at,updated_at`, d.FiscalYear, strings.TrimSpace(d.SourceUnit), strings.TrimSpace(d.Title), strings.TrimSpace(d.OutputTarget), d.ProposedBudget, d.Classification, user, id))
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE sdl_subbagren_review_cases SET has_revision=true,updated_by=$1,updated_at=now() WHERE proposal_id=$2`, user, id)
	if err != nil || reviewLog(r.Context(), tx, user, p, "revised", d.Reason) != nil || tx.Commit(r.Context()) != nil {
		reject(w, 503, "unavailable")
		return
	}
	p.ReviewStatus = "revision_requested"
	p.RevisionCount = c.RevisionCount
	respond(w, 200, map[string]any{"item": p})
}
func (a *API) resubmit(w http.ResponseWriter, r *http.Request) {
	var input actionRequest
	if !decode(w, r, &input) {
		return
	}
	if input.Version < 1 || !validReason(input.Reason) {
		reject(w, 400, "invalid_input")
		return
	}
	id, user := chi.URLParam(r, "id"), actor(r.Context())
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	p, err := a.loadForUpdate(r.Context(), tx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "not_found")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if p.CreatedBy != user {
		reject(w, 404, "not_found")
		return
	}
	if !a.authorize(w, r.Context(), user, "subbagren.usulan.submit", p) {
		return
	}
	c, err := caseForUpdate(r.Context(), tx, id)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if p.Status != "submitted" || p.Version != input.Version || c.Status != "revision_requested" || !c.HasRevision || c.RevisionCount >= 100 {
		reject(w, 409, "version_or_status_conflict")
		return
	}
	p, err = scan(tx.QueryRow(r.Context(), `UPDATE sdl_subbagren_proposals SET updated_by=$1,updated_at=now(),version=version+1 WHERE id=$2 RETURNING id::text,number,fiscal_year,source_unit,title,output_target,proposed_budget,classification,status,created_by::text,version,created_at,updated_at`, user, id))
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE sdl_subbagren_review_cases SET review_status='pending',has_revision=false,revision_count=revision_count+1,updated_by=$1,updated_at=now() WHERE proposal_id=$2`, user, id)
	if err != nil || reviewLog(r.Context(), tx, user, p, "resubmitted", input.Reason) != nil || tx.Commit(r.Context()) != nil {
		reject(w, 503, "unavailable")
		return
	}
	p.ReviewStatus = "pending"
	p.RevisionCount = c.RevisionCount + 1
	respond(w, 200, map[string]any{"item": p})
}

type consolidationEntry struct {
	FiscalYear  int    `json:"fiscalYear"`
	SourceUnit  string `json:"sourceUnit"`
	Count       int    `json:"count"`
	TotalBudget string `json:"totalBudget"`
}

func (a *API) consolidation(w http.ResponseWriter, r *http.Request) {
	user := actor(r.Context())
	year := 0
	if raw := r.URL.Query().Get("year"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 2020 || n > 2100 {
			reject(w, 400, "invalid_year")
			return
		}
		year = n
	}
	candidate := Proposal{CreatedBy: user, Classification: "biasa", Status: "submitted"}
	allowed, err := a.permitted(r.Context(), user, "subbagren.usulan.consolidate", candidate)
	if err != nil {
		reject(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		reject(w, 403, "access_denied")
		return
	}
	// Bound the result: fail rather than show deceptively incomplete budget totals.
	rows, err := a.DB.Query(r.Context(), columns+` WHERE ($1::int=0 OR fiscal_year=$1) AND status='submitted' AND id IN (SELECT proposal_id FROM sdl_subbagren_review_cases WHERE review_status='approved') ORDER BY id LIMIT 2001`, year)
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
	if len(candidates) > 2000 {
		reject(w, 409, "consolidation_requires_pagination")
		return
	}
	type aggregate struct {
		year  int
		unit  string
		n     int
		total int64
	}
	groups := map[string]*aggregate{}
	count := 0
	for _, p := range candidates {
		readable, e := a.permitted(r.Context(), user, "subbagren.usulan.read", p)
		if e != nil {
			reject(w, 503, "authorization_unavailable")
			return
		}
		consolidatable, e := a.permitted(r.Context(), user, "subbagren.usulan.consolidate", p)
		if e != nil {
			reject(w, 503, "authorization_unavailable")
			return
		}
		if !readable || !consolidatable {
			continue
		}
		key := strconv.Itoa(p.FiscalYear) + "\x00" + p.SourceUnit
		g := groups[key]
		if g == nil {
			g = &aggregate{year: p.FiscalYear, unit: p.SourceUnit}
			groups[key] = g
		}
		g.n++
		g.total += p.ProposedBudget
		count++
	}
	out := make([]consolidationEntry, 0, len(groups))
	for _, g := range groups {
		out = append(out, consolidationEntry{FiscalYear: g.year, SourceUnit: g.unit, Count: g.n, TotalBudget: strconv.FormatInt(g.total, 10)})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].FiscalYear != out[j].FiscalYear {
			return out[i].FiscalYear > out[j].FiscalYear
		}
		return out[i].SourceUnit < out[j].SourceUnit
	})
	respond(w, 200, map[string]any{"items": out, "count": count, "basis": "approved_internal_only", "finalBudgetApproval": false})
}
