package urmin

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// Forwarding is a new explicit capability, not implied by execute or by
// membership in the distribution's unit. No independent cross-unit forwarding.
func (a *API) forwardingAllowed(ctx context.Context, user string, parent dispositionTask) (bool, error) {
	if parent.AssigneeID != user || parent.Status != "in_progress" || parent.Depth >= 2 {
		return false, nil
	}
	ok, err := a.taskParty(ctx, user, parent)
	if err != nil || !ok {
		return false, err
	}
	return a.dispositionEligible(ctx, user, parent.Unit, parent.Classification, "urmin.disposisi.forward")
}

// Return all users in the path so a task cannot be routed back to its issuer
// or any earlier party, including a grandparent (loop prevention).
func (a *API) dispositionPathUsers(ctx context.Context, t dispositionTask) (map[string]bool, error) {
	blocked := map[string]bool{}
	seen := map[string]bool{}
	for {
		if seen[t.ID] || len(seen) > 3 {
			return nil, errors.New("invalid_disposition_chain")
		}
		seen[t.ID] = true
		blocked[t.IssuerID] = true
		blocked[t.AssigneeID] = true
		if t.ParentTaskID == nil {
			return blocked, nil
		}
		parent, err := a.loadTask(ctx, *t.ParentTaskID)
		if err != nil {
			return nil, err
		}
		t = parent
	}
}

func (a *API) forwardCandidates(w http.ResponseWriter, r *http.Request) {
	id, user := chi.URLParam(r, "taskId"), actor(r.Context())
	if !uuidPattern.MatchString(id) {
		fail(w, 404, "not_found")
		return
	}
	parent, err := a.loadTask(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if parent.AssigneeID != user {
		fail(w, 404, "not_found")
		return
	}
	ok, err := a.forwardingAllowed(r.Context(), user, parent)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !ok {
		fail(w, 403, "access_denied")
		return
	}
	blocked, err := a.dispositionPathUsers(r.Context(), parent)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT DISTINCT u.id::text,u.display_name FROM sdl_users u JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$1 WHERE u.is_active AND NOT u.must_change_password AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin') ORDER BY u.display_name LIMIT 150`, parent.Unit)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	candidates := []recipient{}
	for rows.Next() {
		var v recipient
		v.Unit = parent.Unit
		if rows.Scan(&v.ID, &v.Name) != nil {
			rows.Close()
			fail(w, 503, "unavailable")
			return
		}
		candidates = append(candidates, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	items := []recipient{}
	for _, v := range candidates {
		if blocked[v.ID] {
			continue
		}
		permitted, e := a.dispositionEligible(r.Context(), v.ID, parent.Unit, parent.Classification, "urmin.disposisi.execute")
		if e != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		if permitted {
			items = append(items, v)
		}
	}
	jsonResponse(w, 200, map[string]any{"items": items, "parentTaskId": parent.ID, "nextDepth": parent.Depth + 1, "latestDueDate": parent.DueDate})
}

func (a *API) forwardDisposition(w http.ResponseWriter, r *http.Request) {
	id, user := chi.URLParam(r, "taskId"), actor(r.Context())
	if !uuidPattern.MatchString(id) {
		fail(w, 404, "not_found")
		return
	}
	var p struct {
		AssigneeID  string `json:"assigneeId"`
		Instruction string `json:"instruction"`
		DueDate     string `json:"dueDate"`
		Version     int64  `json:"version"`
	}
	if !readJSON(w, r, &p) {
		return
	}
	if !uuidPattern.MatchString(p.AssigneeID) || !validText(p.Instruction, 8, 1000) || !validDispositionDue(p.DueDate) || p.Version < 1 || p.AssigneeID == user {
		fail(w, 400, "invalid_input")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	parent, err := scanTask(tx.QueryRow(r.Context(), taskSelect+` WHERE t.id=$1 FOR UPDATE OF t`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if parent.AssigneeID != user {
		fail(w, 404, "not_found")
		return
	}
	allowed, err := a.forwardingAllowed(r.Context(), user, parent)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 403, "access_denied")
		return
	}
	if parent.Version != p.Version {
		fail(w, 409, "version_conflict")
		return
	}
	if p.DueDate > parent.DueDate {
		fail(w, 409, "child_due_after_parent")
		return
	}
	blocked, err := a.dispositionPathUsers(r.Context(), parent)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if blocked[p.AssigneeID] {
		fail(w, 403, "route_loop_denied")
		return
	}
	allowed, err = a.dispositionEligible(r.Context(), p.AssigneeID, parent.Unit, parent.Classification, "urmin.disposisi.execute")
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 403, "assignee_not_eligible")
		return
	}
	var duplicated bool
	err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_urmin_disposition_tasks WHERE parent_task_id=$1 AND assigned_to=$2 AND status IN ('pending','in_progress'))`, id, p.AssigneeID).Scan(&duplicated)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if duplicated {
		fail(w, 409, "open_task_exists")
		return
	}
	var childID string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_urmin_disposition_tasks(parent_task_id,depth,distribution_id,incoming_id,unit_key,issued_by,assigned_to,instruction,due_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::date) RETURNING id::text`, id, parent.Depth+1, parent.DistributionID, parent.IncomingID, parent.Unit, user, p.AssigneeID, strings.TrimSpace(p.Instruction), p.DueDate).Scan(&childID)
	if err != nil {
		fail(w, 409, "disposition_conflict")
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_urmin_disposition_events(disposition_id,actor_id,event_key,reason) VALUES($1,$2,'issued',$3)`, childID, user, strings.TrimSpace(p.Instruction)); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if _, err = tx.Exec(r.Context(), `UPDATE sdl_urmin_disposition_tasks SET version=version+1,updated_at=now() WHERE id=$1`, id); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if err = audit(r.Context(), tx, user, "urmin.disposisi.forwarded", childID); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if err = enqueueUrminEmail(r.Context(), tx, childID, p.AssigneeID, "forwarded"); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 201, map[string]any{"id": childID, "parentTaskId": id, "depth": parent.Depth + 1, "status": "pending"})
}
