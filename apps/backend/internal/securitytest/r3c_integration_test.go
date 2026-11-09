//go:build r2d5integration

package securitytest

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"
)

// R3C uses the same ephemeral database and real Go HTTP router as R2D5/R3B.
func verifyR3CDisposition(t *testing.T, e *testEnv, op, sa *browser) {
	ctx := context.Background()
	add := func(name string) *browser {
		t.Helper()
		user := e.createUser(t, ctx, name, false, true, false)
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,'subbagren',true)`, user.id); err != nil {
			t.Fatal(err)
		}
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by) VALUES($1,'operator','subbagren','assigned','biasa','R3C isolated security verification',$2)`, user.id, e.users["sa_r2d5"].id); err != nil {
			t.Fatal(err)
		}
		b := e.newBrowser(t)
		b.login(t, name, 200)
		return b
	}
	manager := add("r3c_manager")
	worker := add("r3c_worker")
	bystander := add("r3c_unassigned")
	users := []string{"r3c_manager", "r3c_worker", "r3c_unassigned"}
	ids := make([]string, 0, len(users))
	for _, u := range users {
		var id string
		if err := e.db.QueryRow(ctx, `SELECT id::text FROM sdl_users WHERE username=$1`, u).Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	for _, p := range []string{"urmin.distribusi.receive"} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('operator',$1) ON CONFLICT DO NOTHING`, p); err != nil {
			t.Fatal(err)
		}
	}
	p := map[string]any{"letterNumber": "R3C-SECURITY-001", "sender": "Internal security test", "letterDate": time.Now().UTC().Format("2006-01-02"), "receivedDate": time.Now().UTC().Format("2006-01-02"), "subject": "Disposition scope and history verification", "classification": "biasa", "reason": "Isolated R3C test-only incoming document"}
	r, body := op.call(t, "POST", "/api/v1/urmin/surat-masuk/", p, true)
	status(t, r, body, 201)
	var created struct {
		Item struct {
			ID      string `json:"id"`
			Version int64  `json:"version"`
		} `json:"item"`
	}
	if json.Unmarshal(body, &created) != nil || created.Item.ID == "" {
		t.Fatal("missing letter")
	}
	letter := created.Item.ID
	r, body = op.call(t, "POST", "/api/v1/urmin/surat-masuk/"+letter+"/register", map[string]any{"reason": "Register for isolated R3C integration", "version": created.Item.Version}, true)
	status(t, r, body, 200)
	url := "/api/v1/urmin/surat-masuk/" + letter + "/distributions"
	r, body = op.call(t, "POST", url, map[string]any{"unit": "subbagren", "recipientId": ids[0], "reason": "Address manager explicitly for R3C disposition"}, true)
	status(t, r, body, 201)
	var delivered struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(body, &delivered) != nil || delivered.ID == "" {
		t.Fatal("missing distribution id")
	}
	issueURL := "/api/v1/urmin/distribution-inbox/" + delivered.ID + "/dispositions"
	due := time.Now().UTC().AddDate(0, 0, 7).Format("2006-01-02")
	payload := map[string]any{"assigneeId": ids[1], "instruction": "Review the letter and submit written findings", "dueDate": due}
	r, body = manager.call(t, "POST", issueURL, payload, true)
	status(t, r, body, 409) // not received yet
	r, body = manager.call(t, "POST", "/api/v1/urmin/distribution-inbox/"+delivered.ID+"/receive", map[string]any{"reason": "Manager acknowledges R3C distribution"}, true)
	status(t, r, body, 200)
	r, body = manager.call(t, "POST", issueURL, payload, true)
	status(t, r, body, 403) // missing issue permission
	for _, perm := range []string{"urmin.disposisi.issue", "urmin.disposisi.execute"} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('operator',$1) ON CONFLICT DO NOTHING`, perm); err != nil {
			t.Fatal(err)
		}
	}
	r, body = manager.call(t, "GET", "/api/v1/urmin/distribution-inbox/"+delivered.ID+"/disposition-candidates", nil, false)
	status(t, r, body, 200)
	if !bytes.Contains(body, []byte(ids[1])) {
		t.Fatal("eligible worker missing")
	}
	r, body = manager.call(t, "POST", issueURL, payload, true)
	status(t, r, body, 201)
	var issued struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(body, &issued) != nil || issued.ID == "" {
		t.Fatal("missing task id")
	}
	taskID := issued.ID
	r, body = manager.call(t, "POST", issueURL, payload, true)
	status(t, r, body, 409) // pending duplicate
	r, body = sa.call(t, "GET", "/api/v1/urmin/dispositions/", nil, false)
	status(t, r, body, 403)
	r, body = worker.call(t, "GET", "/api/v1/urmin/dispositions/", nil, false)
	status(t, r, body, 200)
	if !bytes.Contains(body, []byte(taskID)) {
		t.Fatal("worker cannot see assigned task")
	}
	r, body = bystander.call(t, "GET", "/api/v1/urmin/dispositions/", nil, false)
	status(t, r, body, 200)
	if bytes.Contains(body, []byte(taskID)) {
		t.Fatal("same-unit unassigned user saw task")
	}
	r, body = bystander.call(t, "GET", "/api/v1/urmin/dispositions/"+taskID+"/history", nil, false)
	status(t, r, body, 404)
	r, body = bystander.call(t, "GET", "/api/v1/urmin/surat-masuk/"+letter+"/attachments", nil, false)
	status(t, r, body, 404)
	r, body = worker.call(t, "GET", "/api/v1/urmin/surat-masuk/"+letter+"/attachments", nil, false)
	status(t, r, body, 200)
	r, body = manager.call(t, "POST", "/api/v1/urmin/dispositions/"+taskID+"/accept", map[string]any{"reason": "Issuer cannot acknowledge subordinate task", "version": int64(1)}, true)
	status(t, r, body, 404)
	acceptURL := "/api/v1/urmin/dispositions/" + taskID + "/accept"
	r, body = worker.call(t, "POST", acceptURL, map[string]any{"reason": "Missing CSRF must fail", "version": int64(1)}, false)
	status(t, r, body, 403)
	r, body = worker.call(t, "POST", acceptURL, map[string]any{"reason": "Assignment accepted by the responsible worker", "version": int64(1)}, true)
	status(t, r, body, 200)
	r, body = worker.call(t, "POST", acceptURL, map[string]any{"reason": "Replay must not change anything", "version": int64(1)}, true)
	status(t, r, body, 409)
	completeURL := "/api/v1/urmin/dispositions/" + taskID + "/complete"
	r, body = worker.call(t, "POST", completeURL, map[string]any{"reason": "Written findings submitted and recorded", "version": int64(2)}, true)
	status(t, r, body, 200)
	r, body = worker.call(t, "POST", completeURL, map[string]any{"reason": "Duplicated completion must not succeed", "version": int64(3)}, true)
	status(t, r, body, 409)
	// R3D1: only original issuer with explicit review permission may assess completion.
	reviewURL := "/api/v1/urmin/dispositions/" + taskID + "/review"
	reviewBody := map[string]any{"decision": "approved", "reason": "Reviewed and accepted after validating the written response", "version": int64(3)}
	r, body = worker.call(t, "POST", reviewURL, reviewBody, true)
	status(t, r, body, 404) // completed assignee is not the approver
	r, body = bystander.call(t, "POST", reviewURL, reviewBody, true)
	status(t, r, body, 404) // same-unit nonparty never reviews
	r, body = sa.call(t, "POST", reviewURL, reviewBody, true)
	status(t, r, body, 403)
	r, body = manager.call(t, "POST", reviewURL, reviewBody, true)
	status(t, r, body, 403) // issuer cannot review before grant
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('operator','urmin.disposisi.review') ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	r, body = manager.call(t, "POST", reviewURL, reviewBody, false)
	status(t, r, body, 403) // CSRF still mandatory
	r, body = manager.call(t, "POST", reviewURL, reviewBody, true)
	status(t, r, body, 200)
	r, body = manager.call(t, "POST", reviewURL, reviewBody, true)
	status(t, r, body, 409) // single immutable approval
	r, body = manager.call(t, "GET", "/api/v1/urmin/dispositions/"+taskID+"/history", nil, false)
	status(t, r, body, 200)
	if !bytes.Contains(body, []byte(`"status":"completed"`)) || !bytes.Contains(body, []byte(`"action":"completed"`)) || !bytes.Contains(body, []byte(`"action":"approved"`)) {
		t.Fatal("missing completed status or event history")
	}
	r, body = worker.call(t, "GET", "/api/v1/urmin/surat-masuk/"+letter, nil, false)
	status(t, r, body, 404) // task is not Urmin registry access
	// Revocation immediately invalidates the explicit task capability.
	if _, err := e.db.Exec(ctx, `UPDATE sdl_access_grants SET revoked_at=now() WHERE user_id=$1`, ids[1]); err != nil {
		t.Fatal(err)
	}
	r, body = worker.call(t, "GET", "/api/v1/urmin/dispositions/", nil, false)
	status(t, r, body, 200)
	if bytes.Contains(body, []byte(taskID)) {
		t.Fatal("revoked worker still sees task")
	}
	r, body = worker.call(t, "GET", "/api/v1/urmin/surat-masuk/"+letter+"/attachments", nil, false)
	status(t, r, body, 404)
}
