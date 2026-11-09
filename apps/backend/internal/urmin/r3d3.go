package urmin

import (
	"context"
	"errors"
	"net/http"
	"siera-delta-lima/backend/internal/devdemo"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// Leadership is NOT inherited from read permission. A live named Kabagrenmin
// role grant in the SAME unit and classification is required for every read
// and decision. Superadmin is explicitly forbidden even if erroneously granted.
func (a *API) leadershipAllowed(ctx context.Context, user, unit, class, permission string) (bool, error) {
	if !uuidPattern.MatchString(user) || (permission != "urmin.disposisi.final.monitor" && permission != "urmin.disposisi.final.approve") || (class != "biasa" && class != "penting") {
		return false, nil
	}
	switch unit {
	case "urmin", "subbagren", "subbagsumda", "subbagbinfung":
	default:
		return false, nil
	}
	if demo, err := devdemo.Superadmin(ctx, a.DB, user); err != nil || demo {
		return false, err // R5F20B: operational deny, including demo Superadmin
	}

	var ok bool
	err := a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_users u
 JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$2
 JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=$2 AND g.role_key='br_kabagrenmin' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now())
 JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
 JOIN sdl_org_units ou ON ou.unit_key=g.unit_key AND ou.is_active
 JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key=$4
 WHERE u.id=$1 AND u.is_active AND NOT u.must_change_password
 AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')
 AND ($3='biasa' OR g.classification_limit='penting'))`, user, unit, class, permission).Scan(&ok)
	return ok, err
}

type finalState struct {
	Status         string     `json:"status"`
	SubmittedBy    string     `json:"submittedBy,omitempty"`
	SubmittedAt    *time.Time `json:"submittedAt,omitempty"`
	DecisionBy     *string    `json:"decidedBy,omitempty"`
	DecisionAt     *time.Time `json:"decidedAt,omitempty"`
	DecisionReason *string    `json:"decisionReason,omitempty"`
	Version        int64      `json:"version"`
}

func (a *API) finalState(ctx context.Context, root string) (finalState, error) {
	var f finalState
	err := a.DB.QueryRow(ctx, `SELECT status,submitted_by::text,submitted_at,decided_by::text,decided_at,decision_reason,version FROM sdl_urmin_final_approvals WHERE root_task_id=$1`, root).Scan(&f.Status, &f.SubmittedBy, &f.SubmittedAt, &f.DecisionBy, &f.DecisionAt, &f.DecisionReason, &f.Version)
	return f, err
}

var errChainInactive = errors.New("chain_no_longer_authorized")

type progressInfo struct {
	Total      int  `json:"totalTasks"`
	Approved   int  `json:"reviewedApproved"`
	Percent    int  `json:"progressPercent"`
	Ready      bool `json:"readyForSubmission"`
	AutoClosed bool `json:"autoClosed,omitempty"`
}

// Progress is derived from immutable task reviews, not manually edited.
// The first 90% represents reviewed-approved tasks; final sign-off is 100%.
func progressPercent(reviewed, total int, status string) int {
	if total <= 0 {
		return 0
	}
	if status == "approved" {
		return 100
	}
	return reviewed * 90 / total
}
func (a *API) taskProgress(ctx context.Context, root dispositionTask, finalStatus string) (progressInfo, error) {
	p := progressInfo{}
	rows, err := a.DB.Query(ctx, `WITH RECURSIVE chain AS (
 SELECT id,status FROM sdl_urmin_disposition_tasks WHERE id=$1
 UNION ALL
 SELECT c.id,c.status FROM sdl_urmin_disposition_tasks c JOIN chain p ON c.parent_task_id=p.id
 ) SELECT chain.id::text,chain.status,COALESCE(r.decision,'') FROM chain LEFT JOIN sdl_urmin_disposition_reviews r ON r.disposition_id=chain.id`, root.ID)
	if err != nil {
		return p, err
	}
	type node struct{ id, status, review string }
	nodes := []node{}
	for rows.Next() {
		var n node
		if err = rows.Scan(&n.id, &n.status, &n.review); err != nil {
			break
		}
		nodes = append(nodes, n)
		if len(nodes) > 150 {
			err = errors.New("chain_exceeds_limit")
			break
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return p, err
	}
	p.Total = len(nodes)
	p.Ready = p.Total > 0
	for _, n := range nodes {
		if n.status == "completed" && n.review == "approved" {
			p.Approved++
		} else {
			p.Ready = false
		}
		// A stale or revoked link means this task cannot be approved or reported.
		t, e := a.loadTask(ctx, n.id)
		if e != nil {
			return progressInfo{}, e
		}
		ok, e := a.taskChainValid(ctx, t)
		if e != nil {
			return progressInfo{}, e
		}
		if !ok {
			return progressInfo{}, errChainInactive
		}
	}
	p.Percent = progressPercent(p.Approved, p.Total, finalStatus)
	return p, nil
}

// R5F20: In the short URMIN demo flow, the Kabagrenmin who directly
// assigned a single task already reviewed and approved its result.
// That review is the closing decision: do not require a second final
// submission from the same actor. Multi-task, cross-unit and preexisting
// formal final approvals retain R3D3's independent approval workflow.
func autoCloseSimpleCandidate(root dispositionTask, state string, p progressInfo) bool {
	return root.Unit == "urmin" && root.Classification == "biasa" &&
		root.ParentTaskID == nil && root.Depth == 0 && state == "not_submitted" &&
		p.Total == 1 && p.Approved == 1 && p.Ready
}

func (a *API) markSimpleDispositionComplete(ctx context.Context, root dispositionTask, state *finalState, progress *progressInfo) error {
	if !autoCloseSimpleCandidate(root, state.Status, *progress) {
		return nil
	}
	// Historical grant is proof of the issuing role, NOT authorization.
	// Visibility and modification always pass the current taskChainValid and
	// permission checks. A 7-day demo grant expiry must not reverse a past
	// approved completion to 90%.
	var allowed bool
	err := a.DB.QueryRow(ctx, `SELECT EXISTS (
        SELECT 1 FROM sdl_access_grants g
        WHERE g.user_id=$1 AND g.unit_key=$2 AND g.role_key='br_kabagrenmin'
          AND ($3='biasa' OR g.classification_limit='penting')
    )`, root.IssuerID, root.Unit, root.Classification).Scan(&allowed)
	if err != nil {
		return err
	}
	if allowed {
		// Derived only from an immutable task review; never alter legacy approvals.
		state.Status = "approved"
		progress.Percent = 100
		progress.Ready = false
		progress.AutoClosed = true
	}
	return nil
}

type leadershipRow struct {
	RootTaskID     string       `json:"rootTaskId"`
	LetterNumber   string       `json:"letterNumber"`
	Subject        string       `json:"subject"`
	Unit           string       `json:"unit"`
	Classification string       `json:"classification"`
	IssuerName     string       `json:"issuerName"`
	AssigneeName   string       `json:"assigneeName"`
	DueDate        string       `json:"dueDate"`
	SLAStatus      string       `json:"slaStatus"`
	ApprovalStatus string       `json:"approvalStatus"`
	Progress       progressInfo `json:"progress"`
	Version        int64        `json:"version"`
}

func (a *API) leadershipDashboard(w http.ResponseWriter, r *http.Request) {
	user := actor(r.Context())
	// Never reveal the global list of letter IDs or total cases to unqualified users.
	rows, err := a.DB.Query(r.Context(), taskSelect+` WHERE t.parent_task_id IS NULL ORDER BY t.created_at DESC,t.id DESC LIMIT 151`)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	roots := []dispositionTask{}
	for rows.Next() {
		t, e := scanTask(rows)
		if e != nil {
			err = e
			break
		}
		roots = append(roots, t)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	items := []leadershipRow{}
	for _, t := range roots {
		ok, e := a.leadershipAllowed(r.Context(), user, t.Unit, t.Classification, "urmin.disposisi.final.monitor")
		if e != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		if !ok {
			continue
		}
		state, e := a.finalState(r.Context(), t.ID)
		if errors.Is(e, pgx.ErrNoRows) {
			state.Status = "not_submitted"
		} else if e != nil {
			fail(w, 503, "unavailable")
			return
		}
		progress, e := a.taskProgress(r.Context(), t, state.Status)
		if errors.Is(e, errChainInactive) {
			continue
		}
		if e != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		if e = a.markSimpleDispositionComplete(r.Context(), t, &state, &progress); e != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		items = append(items, leadershipRow{t.ID, t.LetterNumber, t.Subject, t.Unit, t.Classification, t.IssuerName, t.AssigneeName, t.DueDate, t.SLAStatus, state.Status, progress, state.Version})
	}
	// This endpoint must distinguish access denied from a legitimately empty dashboard.
	var eligible bool
	for _, u := range []string{"urmin", "subbagren", "subbagsumda", "subbagbinfung"} {
		for _, c := range []string{"biasa", "penting"} {
			ok, e := a.leadershipAllowed(r.Context(), user, u, c, "urmin.disposisi.final.monitor")
			if e != nil {
				fail(w, 503, "authorization_unavailable")
				return
			}
			if ok {
				eligible = true
			}
		}
	}
	if !eligible {
		fail(w, 403, "access_denied")
		return
	}
	pending, late, approved := 0, 0, 0
	for _, item := range items {
		if item.ApprovalStatus == "pending" {
			pending++
		}
		if item.ApprovalStatus == "approved" {
			approved++
		}
		if item.SLAStatus == "overdue" {
			late++
		}
	}
	jsonResponse(w, 200, map[string]any{"items": items, "pendingApproval": pending, "overdue": late, "approved": approved, "limited": len(roots) == 151, "updatedAt": time.Now().UTC()})
}

func (a *API) rootForFinal(w http.ResponseWriter, r *http.Request) (dispositionTask, bool) {
	id := chi.URLParam(r, "taskId")
	if !uuidPattern.MatchString(id) {
		fail(w, 404, "not_found")
		return dispositionTask{}, false
	}
	t, e := a.loadTask(r.Context(), id)
	if errors.Is(e, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return t, false
	}
	if e != nil {
		fail(w, 503, "unavailable")
		return t, false
	}
	if t.ParentTaskID != nil || t.Depth != 0 {
		fail(w, 404, "not_found")
		return t, false
	}
	return t, true
}
func (a *API) finalStatus(w http.ResponseWriter, r *http.Request) {
	t, ok := a.rootForFinal(w, r)
	if !ok {
		return
	}
	user := actor(r.Context())
	valid, e := a.taskChainValid(r.Context(), t)
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !valid {
		fail(w, 403, "access_denied")
		return
	}
	lead, e := a.leadershipAllowed(r.Context(), user, t.Unit, t.Classification, "urmin.disposisi.final.monitor")
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	party, e := a.taskParty(r.Context(), user, t)
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !lead && !(party && user == t.IssuerID) {
		fail(w, 404, "not_found")
		return
	}
	state, e := a.finalState(r.Context(), t.ID)
	if errors.Is(e, pgx.ErrNoRows) {
		state.Status = "not_submitted"
	} else if e != nil {
		fail(w, 503, "unavailable")
		return
	}
	progress, e := a.taskProgress(r.Context(), t, state.Status)
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if e = a.markSimpleDispositionComplete(r.Context(), t, &state, &progress); e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	jsonResponse(w, 200, map[string]any{"rootTaskId": t.ID, "approval": state, "progress": progress})
}
func (a *API) submitFinal(w http.ResponseWriter, r *http.Request) {
	t, ok := a.rootForFinal(w, r)
	if !ok {
		return
	}
	var p struct {
		Reason  string `json:"reason"`
		Version int64  `json:"version"`
	}
	if !readJSON(w, r, &p) {
		return
	}
	if !validText(p.Reason, 8, 1000) || p.Version < 1 {
		fail(w, 400, "invalid_input")
		return
	}
	user := actor(r.Context())
	if user != t.IssuerID {
		fail(w, 404, "not_found")
		return
	}
	allowed, e := a.taskParty(r.Context(), user, t)
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 403, "access_denied")
		return
	}
	for _, perm := range []string{"urmin.disposisi.review", "urmin.disposisi.final.submit"} {
		allowed, e = a.dispositionEligible(r.Context(), user, t.Unit, t.Classification, perm)
		if e != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		if !allowed {
			fail(w, 403, "access_denied")
			return
		}
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	locked, e := scanTask(tx.QueryRow(r.Context(), taskSelect+` WHERE t.id=$1 FOR UPDATE OF t`, t.ID))
	if e != nil {
		fail(w, 503, "unavailable")
		return
	}
	if locked.Version != p.Version {
		fail(w, 409, "version_conflict")
		return
	}
	progress, e := a.taskProgress(r.Context(), locked, "")
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !progress.Ready {
		fail(w, 409, "disposition_chain_incomplete")
		return
	}
	// The simple, already-reviewed Kabagrenmin case closes automatically.
	status := finalState{Status: "not_submitted"}
	if e = a.markSimpleDispositionComplete(r.Context(), locked, &status, &progress); e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if progress.AutoClosed {
		fail(w, 409, "already_completed")
		return
	}
	_, e = tx.Exec(r.Context(), `INSERT INTO sdl_urmin_final_approvals(root_task_id,submitted_by,submission_reason) VALUES($1,$2,$3)`, t.ID, user, strings.TrimSpace(p.Reason))
	if e != nil {
		fail(w, 409, "already_submitted")
		return
	}
	if e = audit(r.Context(), tx, user, "urmin.disposisi.final.submitted", t.ID); e != nil {
		fail(w, 503, "unavailable")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 201, map[string]any{"rootTaskId": t.ID, "approvalStatus": "pending", "progressPercent": 90})
}
func (a *API) decideFinal(w http.ResponseWriter, r *http.Request) {
	t, ok := a.rootForFinal(w, r)
	if !ok {
		return
	}
	var p struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
		Version  int64  `json:"version"`
	}
	if !readJSON(w, r, &p) {
		return
	}
	if (p.Decision != "approved" && p.Decision != "revision_requested") || !validText(p.Reason, 8, 1000) || p.Version < 1 {
		fail(w, 400, "invalid_input")
		return
	}
	user := actor(r.Context())
	allowed, e := a.leadershipAllowed(r.Context(), user, t.Unit, t.Classification, "urmin.disposisi.final.approve")
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 403, "access_denied")
		return
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	// Lock root before decision to serialize with workflow changes.
	locked, e := scanTask(tx.QueryRow(r.Context(), taskSelect+` WHERE t.id=$1 FOR UPDATE OF t`, t.ID))
	if e != nil {
		fail(w, 503, "unavailable")
		return
	}
	progress, e := a.taskProgress(r.Context(), locked, "")
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !progress.Ready {
		fail(w, 409, "disposition_chain_incomplete")
		return
	}
	// A leader who participated in ANY task in this case cannot approve it.
	var conflict bool
	e = tx.QueryRow(r.Context(), `WITH RECURSIVE chain AS (SELECT id,issued_by,assigned_to FROM sdl_urmin_disposition_tasks WHERE id=$1 UNION ALL SELECT c.id,c.issued_by,c.assigned_to FROM sdl_urmin_disposition_tasks c JOIN chain p ON c.parent_task_id=p.id) SELECT EXISTS(SELECT 1 FROM chain WHERE issued_by=$2 OR assigned_to=$2)`, t.ID, user).Scan(&conflict)
	if e != nil {
		fail(w, 503, "unavailable")
		return
	}
	if conflict {
		fail(w, 403, "self_approval_denied")
		return
	}
	var state, submittedBy string
	var version int64
	e = tx.QueryRow(r.Context(), `SELECT status,submitted_by::text,version FROM sdl_urmin_final_approvals WHERE root_task_id=$1 FOR UPDATE`, t.ID).Scan(&state, &submittedBy, &version)
	if errors.Is(e, pgx.ErrNoRows) {
		fail(w, 409, "not_submitted")
		return
	}
	if e != nil {
		fail(w, 503, "unavailable")
		return
	}
	if state != "pending" || version != p.Version {
		fail(w, 409, "approval_state_conflict")
		return
	}
	if submittedBy == user {
		fail(w, 403, "self_approval_denied")
		return
	}
	_, e = tx.Exec(r.Context(), `UPDATE sdl_urmin_final_approvals SET status=$1,decided_by=$2,decision_reason=$3,decided_at=now(),version=version+1 WHERE root_task_id=$4`, p.Decision, user, strings.TrimSpace(p.Reason), t.ID)
	if e != nil {
		fail(w, 503, "unavailable")
		return
	}
	if e = audit(r.Context(), tx, user, "urmin.disposisi.final."+p.Decision, t.ID); e != nil {
		fail(w, 503, "unavailable")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable")
		return
	}
	percent := 90
	if p.Decision == "approved" {
		percent = 100
	}
	jsonResponse(w, 200, map[string]any{"rootTaskId": t.ID, "approvalStatus": p.Decision, "progressPercent": percent})
}

func (a *API) R3D3Routes(r chi.Router) {
	r.Get("/leadership", a.leadershipDashboard)
	r.Get("/{taskId}/final-status", a.finalStatus)
	r.Post("/{taskId}/submit-final", a.submitFinal)
	r.Post("/{taskId}/decide-final", a.decideFinal)
}
