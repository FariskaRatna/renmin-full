//go:build r2d5integration

package securitytest

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"
)

// R3D2 runs against the SAME disposable PostgreSQL/real HTTP router as the
// existing security test. No persistent accounts, SMTP or documents involved.
func verifyR3D2Hierarchy(t *testing.T, e *testEnv, op, sa *browser) {
	ctx := context.Background()
	newUnitUser := func(name string) (*browser, string) {
		t.Helper()
		u := e.createUser(t, ctx, name, false, true, false)
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,'subbagren',true)`, u.id); err != nil {
			t.Fatal(err)
		}
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by) VALUES($1,'operator','subbagren','assigned','biasa','R3D2 isolated hierarchy validation',$2)`, u.id, e.users["sa_r2d5"].id); err != nil {
			t.Fatal(err)
		}
		b := e.newBrowser(t)
		b.login(t, name, 200)
		return b, u.id
	}
	manager, managerID := newUnitUser("r3d2_manager")
	worker, workerID := newUnitUser("r3d2_worker")
	junior, juniorID := newUnitUser("r3d2_junior")
	trainee, traineeID := newUnitUser("r3d2_trainee")
	outsider, _ := newUnitUser("r3d2_unassigned")
	for _, perm := range []string{"urmin.distribusi.receive", "urmin.disposisi.issue", "urmin.disposisi.execute", "urmin.disposisi.review"} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('operator',$1) ON CONFLICT DO NOTHING`, perm); err != nil {
			t.Fatal(err)
		}
	}
	letterInput := map[string]any{"letterNumber": "R3D2-HIERARCHY-001", "sender": "Test-only unit", "letterDate": time.Now().UTC().Format("2006-01-02"), "receivedDate": time.Now().UTC().Format("2006-01-02"), "subject": "R3D2 parent child chain security validation", "classification": "biasa", "reason": "Register ephemeral document for R3D2 security checks"}
	r, body := op.call(t, "POST", "/api/v1/urmin/surat-masuk/", letterInput, true)
	status(t, r, body, 201)
	var created struct {
		Item struct {
			ID      string `json:"id"`
			Version int64  `json:"version"`
		} `json:"item"`
	}
	if json.Unmarshal(body, &created) != nil || created.Item.ID == "" {
		t.Fatal("missing R3D2 test letter")
	}
	letterID := created.Item.ID
	r, body = op.call(t, "POST", "/api/v1/urmin/surat-masuk/"+letterID+"/register", map[string]any{"reason": "Register R3D2 temporary letter", "version": created.Item.Version}, true)
	status(t, r, body, 200)
	r, body = op.call(t, "POST", "/api/v1/urmin/surat-masuk/"+letterID+"/distributions", map[string]any{"unit": "subbagren", "recipientId": managerID, "reason": "Route test letter to designated hierarchy owner"}, true)
	status(t, r, body, 201)
	var delivery struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(body, &delivery) != nil || delivery.ID == "" {
		t.Fatal("missing R3D2 delivery")
	}
	r, body = manager.call(t, "POST", "/api/v1/urmin/distribution-inbox/"+delivery.ID+"/receive", map[string]any{"reason": "Manager accepts hierarchy test letter"}, true)
	status(t, r, body, 200)
	due := time.Now().UTC().AddDate(0, 0, 9).Format("2006-01-02")
	r, body = manager.call(t, "POST", "/api/v1/urmin/distribution-inbox/"+delivery.ID+"/dispositions", map[string]any{"assigneeId": workerID, "instruction": "Coordinate response and assign separate subtasks", "dueDate": due}, true)
	status(t, r, body, 201)
	var root struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(body, &root) != nil || root.ID == "" {
		t.Fatal("no root task")
	}
	rootURL := "/api/v1/urmin/dispositions/" + root.ID
	r, body = worker.call(t, "POST", rootURL+"/forward", map[string]any{"assigneeId": juniorID, "instruction": "Do the initial document review", "dueDate": due, "version": int64(1)}, true)
	status(t, r, body, 403) // pending parent
	r, body = worker.call(t, "POST", rootURL+"/accept", map[string]any{"reason": "Parent task accepted before delegation", "version": int64(1)}, true)
	status(t, r, body, 200)
	r, body = worker.call(t, "GET", rootURL+"/forward-candidates", nil, false)
	status(t, r, body, 403) // no forward permission
	r, body = worker.call(t, "POST", rootURL+"/forward", map[string]any{"assigneeId": juniorID, "instruction": "Do the initial document review", "dueDate": due, "version": int64(2)}, true)
	status(t, r, body, 403)
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('operator','urmin.disposisi.forward') ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	r, body = worker.call(t, "GET", rootURL+"/forward-candidates", nil, false)
	status(t, r, body, 200)
	if !bytes.Contains(body, []byte(juniorID)) || bytes.Contains(body, []byte(managerID)) {
		t.Fatal("forward candidate filtering failed")
	}
	r, body = worker.call(t, "POST", rootURL+"/forward", map[string]any{"assigneeId": managerID, "instruction": "Attempt to route the task backwards", "dueDate": due, "version": int64(2)}, true)
	status(t, r, body, 403)
	r, body = outsider.call(t, "POST", rootURL+"/forward", map[string]any{"assigneeId": juniorID, "instruction": "Unauthorized user tries forwarding", "dueDate": due, "version": int64(2)}, true)
	status(t, r, body, 404)
	r, body = sa.call(t, "POST", rootURL+"/forward", map[string]any{"assigneeId": juniorID, "instruction": "Superadmin cannot delegate operational work", "dueDate": due, "version": int64(2)}, true)
	status(t, r, body, 403)
	r, body = worker.call(t, "POST", rootURL+"/forward", map[string]any{"assigneeId": juniorID, "instruction": "Junior reviews the registration details", "dueDate": due, "version": int64(2)}, false)
	status(t, r, body, 403)
	r, body = worker.call(t, "POST", rootURL+"/forward", map[string]any{"assigneeId": juniorID, "instruction": "Junior reviews the registration details", "dueDate": time.Now().UTC().AddDate(0, 0, 10).Format("2006-01-02"), "version": int64(2)}, true)
	status(t, r, body, 409)
	r, body = worker.call(t, "POST", rootURL+"/forward", map[string]any{"assigneeId": juniorID, "instruction": "Junior reviews the registration details", "dueDate": due, "version": int64(2)}, true)
	status(t, r, body, 201)
	var child struct {
		ID           string `json:"id"`
		ParentTaskID string `json:"parentTaskId"`
		Depth        int    `json:"depth"`
	}
	if json.Unmarshal(body, &child) != nil || child.ID == "" || child.ParentTaskID != root.ID || child.Depth != 1 {
		t.Fatal("invalid parent-child link")
	}
	r, body = worker.call(t, "POST", rootURL+"/complete", map[string]any{"reason": "Completion must be blocked until child is reviewed", "version": int64(3)}, true)
	status(t, r, body, 409)
	childURL := "/api/v1/urmin/dispositions/" + child.ID
	r, body = junior.call(t, "POST", childURL+"/accept", map[string]any{"reason": "Junior accepted subtask", "version": int64(1)}, true)
	status(t, r, body, 200)
	r, body = junior.call(t, "POST", childURL+"/forward", map[string]any{"assigneeId": traineeID, "instruction": "Trainee checks supporting details", "dueDate": due, "version": int64(2)}, true)
	status(t, r, body, 201)
	var leaf struct {
		ID    string `json:"id"`
		Depth int    `json:"depth"`
	}
	if json.Unmarshal(body, &leaf) != nil || leaf.ID == "" || leaf.Depth != 2 {
		t.Fatal("missing depth-2 child")
	}
	leafURL := "/api/v1/urmin/dispositions/" + leaf.ID
	r, body = trainee.call(t, "POST", leafURL+"/accept", map[string]any{"reason": "Trainee begins delegated review", "version": int64(1)}, true)
	status(t, r, body, 200)
	r, body = trainee.call(t, "GET", leafURL+"/forward-candidates", nil, false)
	status(t, r, body, 403) // depth ceiling
	r, body = trainee.call(t, "POST", leafURL+"/complete", map[string]any{"reason": "Trainee confirmed the supporting documents", "version": int64(2)}, true)
	status(t, r, body, 200)
	r, body = junior.call(t, "POST", childURL+"/complete", map[string]any{"reason": "Cannot finish until grandchild reviewed", "version": int64(3)}, true)
	status(t, r, body, 409)
	r, body = junior.call(t, "POST", leafURL+"/review", map[string]any{"decision": "approved", "reason": "Trainee evidence meets requirements", "version": int64(3)}, true)
	status(t, r, body, 200)
	r, body = junior.call(t, "POST", childURL+"/complete", map[string]any{"reason": "Reviewed the full nested set of findings", "version": int64(3)}, true)
	status(t, r, body, 200)
	r, body = worker.call(t, "POST", childURL+"/review", map[string]any{"decision": "approved", "reason": "Junior review meets the assignment criteria", "version": int64(4)}, true)
	status(t, r, body, 200)
	r, body = worker.call(t, "POST", rootURL+"/complete", map[string]any{"reason": "All subtask outcomes have been reviewed", "version": int64(3)}, true)
	status(t, r, body, 200)
	r, body = manager.call(t, "POST", rootURL+"/review", map[string]any{"decision": "approved", "reason": "Complete hierarchy reviewed and accepted", "version": int64(4)}, true)
	status(t, r, body, 200)
	r, body = outsider.call(t, "GET", leafURL+"/history", nil, false)
	status(t, r, body, 404)
	r, body = junior.call(t, "GET", leafURL+"/history", nil, false)
	status(t, r, body, 200)
	r, body = trainee.call(t, "GET", "/api/v1/urmin/surat-masuk/"+letterID, nil, false)
	status(t, r, body, 404)
	if _, err := e.db.Exec(ctx, `UPDATE sdl_access_grants SET revoked_at=now() WHERE user_id=$1`, juniorID); err != nil {
		t.Fatal(err)
	}
	r, body = trainee.call(t, "GET", leafURL+"/history", nil, false)
	status(t, r, body, 404) // ancestor revoke invalidates child chain
}
