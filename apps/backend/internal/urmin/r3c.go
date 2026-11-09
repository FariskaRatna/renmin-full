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

// R3C is an explicitly addressed disposition workflow. A user must have BOTH
// an active unit grant/role permission and be a party to the particular task.
// A received R3B distribution is mandatory before its recipient can issue tasks.
type dispositionTask struct {
	ID             string     `json:"id"`
	DistributionID string     `json:"distributionId"`
	IncomingID     string     `json:"incomingId"`
	LetterNumber   string     `json:"letterNumber"`
	Subject        string     `json:"subject"`
	Classification string     `json:"classification"`
	Unit           string     `json:"unit"`
	IssuerID       string     `json:"issuerId"`
	IssuerName     string     `json:"issuerName"`
	AssigneeID     string     `json:"assigneeId"`
	AssigneeName   string     `json:"assigneeName"`
	Instruction    string     `json:"instruction"`
	DueDate        string     `json:"dueDate"`
	Status         string     `json:"status"`
	CompletionNote *string    `json:"completionNote"`
	CreatedAt      time.Time  `json:"createdAt"`
	AcceptedAt     *time.Time `json:"acceptedAt"`
	CompletedAt    *time.Time `json:"completedAt"`
	Version        int64      `json:"version"`
	ReviewStatus   string     `json:"reviewStatus"`
	ReviewReason   *string    `json:"reviewReason"`
	ReviewerName   *string    `json:"reviewerName"`
	ReviewedAt     *time.Time `json:"reviewedAt"`
	SLAStatus      string     `json:"slaStatus"`
	ParentTaskID   *string    `json:"parentTaskId"`
	Depth          int        `json:"depth"`
}
type dispositionEvent struct {
	Action string    `json:"action"`
	Actor  string    `json:"actor"`
	Reason string    `json:"reason"`
	At     time.Time `json:"at"`
}

const taskSelect = `SELECT t.id::text,t.distribution_id::text,t.incoming_id::text,i.letter_number,i.subject,i.classification,t.unit_key,t.issued_by::text,issuer.display_name,t.assigned_to::text,assignee.display_name,t.instruction,t.due_date::text,t.status,t.completion_note,t.created_at,t.accepted_at,t.completed_at,t.version,COALESCE(rev.decision,CASE WHEN t.status='completed' THEN 'awaiting_review' ELSE 'not_ready' END),rev.reason,reviewer.display_name,rev.created_at,t.parent_task_id::text,t.depth FROM sdl_urmin_disposition_tasks t JOIN sdl_urmin_incoming i ON i.id=t.incoming_id JOIN sdl_users issuer ON issuer.id=t.issued_by JOIN sdl_users assignee ON assignee.id=t.assigned_to LEFT JOIN sdl_urmin_disposition_reviews rev ON rev.disposition_id=t.id LEFT JOIN sdl_users reviewer ON reviewer.id=rev.reviewed_by`

func scanTask(s scanner) (dispositionTask, error) {
	var t dispositionTask
	err := s.Scan(&t.ID, &t.DistributionID, &t.IncomingID, &t.LetterNumber, &t.Subject, &t.Classification, &t.Unit, &t.IssuerID, &t.IssuerName, &t.AssigneeID, &t.AssigneeName, &t.Instruction, &t.DueDate, &t.Status, &t.CompletionNote, &t.CreatedAt, &t.AcceptedAt, &t.CompletedAt, &t.Version, &t.ReviewStatus, &t.ReviewReason, &t.ReviewerName, &t.ReviewedAt, &t.ParentTaskID, &t.Depth)
	if err == nil {
		t.SLAStatus = dispositionSLA(t, time.Now().UTC())
	}
	return t, err
}
func (a *API) loadTask(ctx context.Context, id string) (dispositionTask, error) {
	return scanTask(a.DB.QueryRow(ctx, taskSelect+` WHERE t.id=$1`, id))
}

// grant must be same-unit, live, classification-compatible, and tied to the
// required role permission. An explicit assignment may be handled even with
// scope 'own', because the task itself is the resource being addressed.
func (a *API) dispositionEligible(ctx context.Context, user, unit, class, permission string) (bool, error) {
	if !uuidPattern.MatchString(user) || (unit != "urmin" && unit != "subbagren" && unit != "subbagsumda" && unit != "subbagbinfung") || (class != "biasa" && class != "penting") {
		return false, nil
	}
	if permission != "urmin.disposisi.issue" && permission != "urmin.disposisi.execute" && permission != "urmin.disposisi.review" && permission != "urmin.disposisi.forward" && permission != "urmin.disposisi.final.submit" {
		return false, nil
	}
	if demo, err := devdemo.Superadmin(ctx, a.DB, user); err != nil || demo {
		return false, err // R5F20B: operational deny, including demo Superadmin
	}

	var ok bool
	err := a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_users u
 JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$2
 JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=$2 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now())
 JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active AND ro.role_key<>'superadmin'
 JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key=$4
 JOIN sdl_org_units ou ON ou.unit_key=g.unit_key AND ou.is_active
 WHERE u.id=$1 AND u.is_active AND NOT u.must_change_password
 AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')
 AND ($3='biasa' OR g.classification_limit='penting'))`, user, unit, class, permission).Scan(&ok)
	return ok, err
}

// Revoking the originating distribution grant also revokes derived task access.
func (a *API) currentIssuer(ctx context.Context, distributionID, issuer, unit, class string) (bool, error) {
	var owner, recipientUnit, status string
	err := a.DB.QueryRow(ctx, `SELECT recipient_user::text,recipient_unit,status FROM sdl_urmin_distributions WHERE id=$1`, distributionID).Scan(&owner, &recipientUnit, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if owner != issuer || recipientUnit != unit || status != "received" {
		return false, nil
	}
	received, err := a.recipientEligible(ctx, issuer, unit, class)
	if err != nil || !received {
		return false, err
	}
	return a.dispositionEligible(ctx, issuer, unit, class, "urmin.disposisi.issue")
}

// Verify every hop of the original distribution -> parent -> child chain.
// No unit-wide implicit access, no stale grants, no cycles and no path beyond
// two forwarded hops (root depth=0, leaf depth<=2).
func (a *API) taskChainValid(ctx context.Context, t dispositionTask) (bool, error) {
	seen := map[string]bool{}
	node := t
	for {
		if node.Depth < 0 || node.Depth > 2 || seen[node.ID] {
			return false, nil
		}
		seen[node.ID] = true
		if node.ParentTaskID == nil {
			if node.Depth != 0 {
				return false, nil
			}
			return a.currentIssuer(ctx, node.DistributionID, node.IssuerID, node.Unit, node.Classification)
		}
		if node.Depth == 0 {
			return false, nil
		}
		parent, err := a.loadTask(ctx, *node.ParentTaskID)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if parent.ID == node.ID || parent.Depth+1 != node.Depth || parent.IncomingID != node.IncomingID || parent.DistributionID != node.DistributionID || parent.Unit != node.Unit || parent.Classification != node.Classification || parent.AssigneeID != node.IssuerID || (parent.Status != "in_progress" && parent.Status != "completed") {
			return false, nil
		}
		for _, perm := range []string{"urmin.disposisi.execute", "urmin.disposisi.forward"} {
			ok, e := a.dispositionEligible(ctx, node.IssuerID, node.Unit, node.Classification, perm)
			if e != nil || !ok {
				return false, e
			}
		}
		node = parent
	}
}
func (a *API) taskParty(ctx context.Context, user string, t dispositionTask) (bool, error) {
	chainOK, err := a.taskChainValid(ctx, t)
	if err != nil || !chainOK {
		return false, err
	}
	if user == t.IssuerID {
		return true, nil
	}
	if user != t.AssigneeID {
		return false, nil
	}
	return a.dispositionEligible(ctx, user, t.Unit, t.Classification, "urmin.disposisi.execute")
}

// Task assignees may read private attachments from only their specific, live
// disposition. This path never grants the right to see the Urmin letter register.
func (a *API) dispositionAttachmentAccess(ctx context.Context, user string, doc Incoming) (bool, error) {
	if !uuidPattern.MatchString(user) || doc.Status != "registered" {
		return false, nil
	}
	rows, err := a.DB.Query(ctx, taskSelect+` WHERE t.incoming_id=$1 AND t.assigned_to=$2 ORDER BY t.created_at DESC LIMIT 100`, doc.ID, user)
	if err != nil {
		return false, err
	}
	tasks := []dispositionTask{}
	for rows.Next() {
		v, e := scanTask(rows)
		if e != nil {
			rows.Close()
			return false, e
		}
		tasks = append(tasks, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return false, err
	}
	for _, t := range tasks {
		ok, e := a.taskParty(ctx, user, t)
		if e != nil {
			return false, e
		}
		if ok {
			return true, nil
		}
	}
	return false, nil
}
func (a *API) dispositionCandidates(w http.ResponseWriter, r *http.Request) {
	id, user := chi.URLParam(r, "distributionId"), actor(r.Context())
	if !uuidPattern.MatchString(id) {
		fail(w, 404, "not_found")
		return
	}
	var incoming, unit, class string
	err := a.DB.QueryRow(r.Context(), `SELECT d.incoming_id::text,d.recipient_unit,i.classification FROM sdl_urmin_distributions d JOIN sdl_urmin_incoming i ON i.id=d.incoming_id WHERE d.id=$1 AND d.recipient_user=$2 AND d.status='received'`, id, user).Scan(&incoming, &unit, &class)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	ok, err := a.currentIssuer(r.Context(), id, user, unit, class)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !ok {
		fail(w, 403, "access_denied")
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT DISTINCT u.id::text,u.display_name FROM sdl_users u JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$1 WHERE u.id<>$2 AND u.is_active AND NOT u.must_change_password AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin') ORDER BY u.display_name LIMIT 100`, unit, user)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	candidates := []recipient{}
	for rows.Next() {
		var v recipient
		v.Unit = unit
		if e := rows.Scan(&v.ID, &v.Name); e != nil {
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
	result := []recipient{}
	for _, v := range candidates {
		eligible, e := a.dispositionEligible(r.Context(), v.ID, unit, class, "urmin.disposisi.execute")
		if e != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		if eligible {
			result = append(result, v)
		}
	}
	jsonResponse(w, 200, map[string]any{"items": result, "unit": unit, "incomingId": incoming})
}
func validDispositionDue(s string) bool {
	if !validDate(s) {
		return false
	}
	today := time.Now().UTC().Truncate(24 * time.Hour)
	d, _ := time.Parse("2006-01-02", s)
	return !d.Before(today) && !d.After(today.AddDate(1, 0, 0))
}
func (a *API) issueDisposition(w http.ResponseWriter, r *http.Request) {
	var p struct {
		AssigneeID  string `json:"assigneeId"`
		Instruction string `json:"instruction"`
		DueDate     string `json:"dueDate"`
	}
	if !readJSON(w, r, &p) {
		return
	}
	if !uuidPattern.MatchString(p.AssigneeID) || !validText(p.Instruction, 8, 1000) || !validDispositionDue(p.DueDate) {
		fail(w, 400, "invalid_input")
		return
	}
	id, user := chi.URLParam(r, "distributionId"), actor(r.Context())
	if !uuidPattern.MatchString(id) || p.AssigneeID == user {
		fail(w, 400, "invalid_input")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var incoming, unit, class, status, owner string
	err = tx.QueryRow(r.Context(), `SELECT d.incoming_id::text,d.recipient_unit,i.classification,d.status,d.recipient_user::text FROM sdl_urmin_distributions d JOIN sdl_urmin_incoming i ON i.id=d.incoming_id WHERE d.id=$1 FOR UPDATE OF d`, id).Scan(&incoming, &unit, &class, &status, &owner)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if owner != user {
		fail(w, 404, "not_found")
		return
	}
	if status != "received" {
		fail(w, 409, "distribution_not_received")
		return
	}
	allowed, err := a.currentIssuer(r.Context(), id, user, unit, class)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 403, "access_denied")
		return
	}
	allowed, err = a.dispositionEligible(r.Context(), p.AssigneeID, unit, class, "urmin.disposisi.execute")
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 403, "assignee_not_eligible")
		return
	}
	var existing bool
	err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_urmin_disposition_tasks WHERE distribution_id=$1 AND assigned_to=$2 AND status IN ('pending','in_progress'))`, id, p.AssigneeID).Scan(&existing)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if existing {
		fail(w, 409, "open_task_exists")
		return
	}
	var taskID string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_urmin_disposition_tasks(distribution_id,incoming_id,unit_key,issued_by,assigned_to,instruction,due_date) VALUES($1,$2,$3,$4,$5,$6,$7::date) RETURNING id::text`, id, incoming, unit, user, p.AssigneeID, strings.TrimSpace(p.Instruction), p.DueDate).Scan(&taskID)
	if err != nil {
		fail(w, 409, "disposition_conflict")
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_urmin_disposition_events(disposition_id,actor_id,event_key,reason) VALUES($1,$2,'issued',$3)`, taskID, user, strings.TrimSpace(p.Instruction)); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if audit(r.Context(), tx, user, "urmin.disposisi.issued", taskID) != nil {
		fail(w, 503, "unavailable")
		return
	}
	if err = enqueueUrminEmail(r.Context(), tx, taskID, p.AssigneeID, "assigned"); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 201, map[string]any{"id": taskID, "status": "pending"})
}
// R5G3, diperbarui R5G8: yang memisahkan aktif dari arsip adalah STATUS, bukan
// umur surat.
//
// Sebuah disposisi masuk arsip ketika pekerjaannya selesai DAN disahkan
// penerbit (`rev.decision='approved'`). Rentang ±15 hari (R5H5; dulu ±30) tetap ada, tapi
// perannya berubah: ia menjaga daftar aktif tidak membengkak, bukan menentukan
// keanggotaan arsip.
//
//	active  = surat dalam ±15 hari DAN belum disahkan
//	archive = sudah disahkan, tanpa memandang tanggal
//	all     = perilaku sebelum R5G3
//
// Keduanya tetap saling melengkapi dalam arti yang penting: sebuah disposisi
// yang sudah disahkan selalu terjangkau lewat 'archive' berapa pun umurnya,
// dan yang belum selalu terjangkau lewat 'active' selama suratnya masih baru.
// 'all' tetap menjadi jalan keluar yang menampilkan semuanya.
//
// Rentang from/to eksplisit menimpa `window` sepenuhnya. Keduanya wajib
// berpasangan: rentang setengah terbuka terbaca sebagai "sejak tanggal ini
// seterusnya", padahal diam-diam tetap kena batas ±15 hari.
func dispositionWindow(r *http.Request) (string, []any, bool) {
	q := r.URL.Query()
	from, to := strings.TrimSpace(q.Get("from")), strings.TrimSpace(q.Get("to"))
	if from != "" || to != "" {
		if !validDate(from) || !validDate(to) || from > to {
			return "", nil, false
		}
		return ` AND i.letter_date BETWEEN $2::date AND $3::date`, []any{from, to}, true
	}
	switch q.Get("window") {
	case "", "active":
		return ` AND i.letter_date BETWEEN CURRENT_DATE - 15 AND CURRENT_DATE + 15 AND COALESCE(rev.decision,'')<>'approved'`, nil, true
	case "archive":
		return ` AND COALESCE(rev.decision,'')='approved'`, nil, true
	case "all":
		return "", nil, true
	}
	return "", nil, false
}

func (a *API) dispositions(w http.ResponseWriter, r *http.Request) {
	user := actor(r.Context())
	window, extra, ok := dispositionWindow(r)
	if !ok {
		fail(w, 400, "invalid_input")
		return
	}
	// The party clause MUST stay parenthesised. Without the brackets the
	// appended AND binds to `t.assigned_to=$1` alone, and every task the caller
	// merely issued would escape the date window.
	args := append([]any{user}, extra...)
	rows, err := a.DB.Query(r.Context(), taskSelect+` WHERE (t.issued_by=$1 OR t.assigned_to=$1)`+window+` ORDER BY t.created_at DESC,t.id DESC LIMIT 200`, args...)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	tasks := []dispositionTask{}
	for rows.Next() {
		v, e := scanTask(rows)
		if e != nil {
			rows.Close()
			fail(w, 503, "unavailable")
			return
		}
		tasks = append(tasks, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	items := []dispositionTask{}
	pending := 0
	overdue := 0
	for _, t := range tasks {
		ok, e := a.taskParty(r.Context(), user, t)
		if e != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		if ok {
			items = append(items, t)
			if t.AssigneeID == user && t.Status != "completed" {
				pending++
				if t.DueDate < time.Now().UTC().Format("2006-01-02") {
					overdue++
				}
			}
		}
	}
	jsonResponse(w, 200, map[string]any{"items": items, "pending": pending, "overdue": overdue, "limited": len(tasks) == 200})
}
func (a *API) dispositionHistory(w http.ResponseWriter, r *http.Request) {
	id, user := chi.URLParam(r, "taskId"), actor(r.Context())
	if !uuidPattern.MatchString(id) {
		fail(w, 404, "not_found")
		return
	}
	t, err := a.loadTask(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	ok, err := a.taskParty(r.Context(), user, t)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !ok {
		fail(w, 404, "not_found")
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT e.event_key,u.display_name,e.reason,e.created_at FROM sdl_urmin_disposition_events e JOIN sdl_users u ON u.id=e.actor_id WHERE e.disposition_id=$1 ORDER BY e.created_at,e.id LIMIT 100`, id)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	events := []dispositionEvent{}
	for rows.Next() {
		var ev dispositionEvent
		if rows.Scan(&ev.Action, &ev.Actor, &ev.Reason, &ev.At) != nil {
			fail(w, 503, "unavailable")
			return
		}
		events = append(events, ev)
	}
	if rows.Err() != nil {
		fail(w, 503, "unavailable")
		return
	}
	if t.ReviewedAt != nil && t.ReviewReason != nil && t.ReviewerName != nil {
		events = append(events, dispositionEvent{Action: t.ReviewStatus, Actor: *t.ReviewerName, Reason: *t.ReviewReason, At: *t.ReviewedAt})
	}
	jsonResponse(w, 200, map[string]any{"item": t, "events": events})
}
func (a *API) changeDisposition(w http.ResponseWriter, r *http.Request, complete bool) {
	id, user := chi.URLParam(r, "taskId"), actor(r.Context())
	if !uuidPattern.MatchString(id) {
		fail(w, 404, "not_found")
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
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	t, err := scanTask(tx.QueryRow(r.Context(), taskSelect+` WHERE t.id=$1 FOR UPDATE OF t`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if user != t.AssigneeID {
		fail(w, 404, "not_found")
		return
	}
	ok, err := a.taskParty(r.Context(), user, t)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !ok {
		fail(w, 403, "access_denied")
		return
	}
	if t.Version != p.Version {
		fail(w, 409, "version_conflict")
		return
	}
	action, from, to := "accepted", "pending", "in_progress"
	if complete {
		action, from, to = "completed", "in_progress", "completed"
	}
	if t.Status != from {
		fail(w, 409, "invalid_workflow_transition")
		return
	}
	if complete {
		// Locking the parent during forwarding and completion prevents a child
		// from being added between the dependency check and the status update.
		var unresolved bool
		err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_urmin_disposition_tasks child LEFT JOIN sdl_urmin_disposition_reviews rev ON rev.disposition_id=child.id WHERE child.parent_task_id=$1 AND (child.status<>'completed' OR rev.id IS NULL))`, id).Scan(&unresolved)
		if err != nil {
			fail(w, 503, "unavailable")
			return
		}
		if unresolved {
			fail(w, 409, "child_tasks_unreviewed")
			return
		}
	}
	if complete {
		_, err = tx.Exec(r.Context(), `UPDATE sdl_urmin_disposition_tasks SET status='completed',completion_note=$1,completed_at=now(),updated_at=now(),version=version+1 WHERE id=$2`, strings.TrimSpace(p.Reason), id)
	} else {
		_, err = tx.Exec(r.Context(), `UPDATE sdl_urmin_disposition_tasks SET status='in_progress',accepted_at=now(),updated_at=now(),version=version+1 WHERE id=$1`, id)
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_urmin_disposition_events(disposition_id,actor_id,event_key,reason) VALUES($1,$2,$3,$4)`, id, user, action, strings.TrimSpace(p.Reason)); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if audit(r.Context(), tx, user, "urmin.disposisi."+action, id) != nil {
		fail(w, 503, "unavailable")
		return
	}
	if complete {
		if err = enqueueUrminEmail(r.Context(), tx, id, t.IssuerID, "completed"); err != nil {
			fail(w, 503, "unavailable")
			return
		}
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 200, map[string]any{"id": id, "status": to, "version": t.Version + 1})
}
func (a *API) acceptDisposition(w http.ResponseWriter, r *http.Request) {
	a.changeDisposition(w, r, false)
}
func (a *API) completeDisposition(w http.ResponseWriter, r *http.Request) {
	a.changeDisposition(w, r, true)
}

// Urmin source tracking requires TWO independent permissions. Never expose a
// task's contents to an operator merely because they registered the letter.
func (a *API) dispositionTracking(w http.ResponseWriter, r *http.Request) {
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
	read, err := a.decision(r.Context(), user, "urmin.surat_masuk.read", doc)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	track, e := a.decision(r.Context(), user, "urmin.disposisi.read", doc)
	if e != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !read || !track {
		fail(w, 404, "not_found")
		return
	}
	rows, err := a.DB.Query(r.Context(), taskSelect+` WHERE t.incoming_id=$1 ORDER BY t.created_at DESC,t.id DESC LIMIT 200`, doc.ID)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	items := []dispositionTask{}
	for rows.Next() {
		t, e := scanTask(rows)
		if e != nil {
			fail(w, 503, "unavailable")
			return
		}
		items = append(items, t)
	}
	if rows.Err() != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 200, map[string]any{"items": items, "limited": len(items) == 200})
}
func (a *API) R3CInboxRoutes(r chi.Router) {
	r.Get("/{distributionId}/disposition-candidates", a.dispositionCandidates)
	r.Post("/{distributionId}/dispositions", a.issueDisposition)
}
func (a *API) R3CTaskRoutes(r chi.Router) {
	r.Get("/", a.dispositions)
	r.Get("/{taskId}/history", a.dispositionHistory)
	r.Post("/{taskId}/accept", a.acceptDisposition)
	r.Post("/{taskId}/complete", a.completeDisposition)
	r.Post("/{taskId}/review", a.reviewDisposition)
	r.Get("/{taskId}/forward-candidates", a.forwardCandidates)
	r.Post("/{taskId}/forward", a.forwardDisposition)
	r.Post("/{taskId}/archive", a.archiveDisposition)
	// R5G6. `/attachments` didaftarkan sebelum `/attachments/{fileId}/download`
	// hanya demi keterbacaan — di chi keduanya tidak bertabrakan. Di Express
	// urutannya WAJIB begini, lihat §6 API-CONTRACT.md.
	r.Post("/{taskId}/attachments", a.uploadDispositionFile)
	r.Get("/{taskId}/attachments", a.listDispositionFiles)
	r.Get("/{taskId}/attachments/{fileId}/download", a.downloadDispositionFile)
	a.R3D3Routes(r)
}
