//go:build r2d5integration

package securitytest

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"
)

// Uses same isolated ephemeral PostgreSQL and real Go API handler as R2D5.
func verifyR3D3Leadership(t *testing.T, e *testEnv, op, sa *browser) {
	ctx := context.Background()
	makeUser := func(name, role string) (*browser, string) {
		t.Helper()
		u := e.createUser(t, ctx, name, false, true, false)
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,'subbagren',true)`, u.id); err != nil {
			t.Fatal(err)
		}
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by) VALUES($1,$2,'subbagren','unit','biasa','R3D3 isolated grant only',$3)`, u.id, role, e.users["sa_r2d5"].id); err != nil {
			t.Fatal(err)
		}
		b := e.newBrowser(t)
		b.login(t, name, 200)
		return b, u.id
	}
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_roles(role_key,display_name) VALUES('br_kabagrenmin','R3D3 Test Kabagrenmin')`); err != nil {
		t.Fatal(err)
	}
	for _, perm := range []string{"urmin.distribusi.receive", "urmin.disposisi.issue", "urmin.disposisi.execute", "urmin.disposisi.review", "urmin.disposisi.final.submit"} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('operator',$1) ON CONFLICT DO NOTHING`, perm); err != nil {
			t.Fatal(err)
		}
	}
	manager, managerID := makeUser("r3d3_issuer", "operator")
	worker, workerID := makeUser("r3d3_worker", "operator")
	lead, leadID := makeUser("r3d3_leader", "br_kabagrenmin")
	other, _ := makeUser("r3d3_outsider", "operator")
	letter := map[string]any{"letterNumber": "R3D3-SECURITY-001", "sender": "Integration test only", "letterDate": "2026-10-20", "receivedDate": "2026-10-20", "subject": "Isolated final approval workflow review", "classification": "biasa", "reason": "Register synthetic document to test final approval"}
	r, b := op.call(t, "POST", "/api/v1/urmin/surat-masuk/", letter, true)
	status(t, r, b, 201)
	var created struct {
		Item struct {
			ID      string `json:"id"`
			Version int64  `json:"version"`
		} `json:"item"`
	}
	if json.Unmarshal(b, &created) != nil || created.Item.ID == "" {
		t.Fatal("missing R3D3 test letter")
	}
	letterID := created.Item.ID
	r, b = op.call(t, "POST", "/api/v1/urmin/surat-masuk/"+letterID+"/register", map[string]any{"reason": "Register the R3D3 synthetic test letter", "version": created.Item.Version}, true)
	status(t, r, b, 200)
	r, b = op.call(t, "POST", "/api/v1/urmin/surat-masuk/"+letterID+"/distributions", map[string]any{"unit": "subbagren", "recipientId": managerID, "reason": "Designated manager receives temporary document"}, true)
	status(t, r, b, 201)
	var dist struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(b, &dist) != nil || dist.ID == "" {
		t.Fatal("missing distribution")
	}
	r, b = manager.call(t, "POST", "/api/v1/urmin/distribution-inbox/"+dist.ID+"/receive", map[string]any{"reason": "Manager accepts the final approval test"}, true)
	status(t, r, b, 200)
	due := time.Now().UTC().AddDate(0, 0, 8).Format("2006-01-02")
	r, b = manager.call(t, "POST", "/api/v1/urmin/distribution-inbox/"+dist.ID+"/dispositions", map[string]any{"assigneeId": workerID, "instruction": "Prepare document for executive sign off", "dueDate": due}, true)
	status(t, r, b, 201)
	var root struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(b, &root) != nil || root.ID == "" {
		t.Fatal("missing root task")
	}
	url := "/api/v1/urmin/dispositions/" + root.ID
	r, b = manager.call(t, "POST", url+"/submit-final", map[string]any{"reason": "Attempt before any work is complete", "version": int64(1)}, true)
	status(t, r, b, 409)
	r, b = lead.call(t, "GET", "/api/v1/urmin/dispositions/leadership", nil, false)
	status(t, r, b, 403) // permission not granted
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('br_kabagrenmin','urmin.disposisi.final.monitor')`); err != nil {
		t.Fatal(err)
	}
	r, b = lead.call(t, "GET", "/api/v1/urmin/dispositions/leadership", nil, false)
	status(t, r, b, 200)
	if !bytes.Contains(b, []byte(root.ID)) {
		t.Fatal("Kabag monitor did not return root case")
	}
	r, b = other.call(t, "GET", "/api/v1/urmin/dispositions/leadership", nil, false)
	status(t, r, b, 403)
	r, b = sa.call(t, "GET", "/api/v1/urmin/dispositions/leadership", nil, false)
	status(t, r, b, 403)
	r, b = worker.call(t, "POST", url+"/accept", map[string]any{"reason": "Operator begins disposition task", "version": int64(1)}, true)
	status(t, r, b, 200)
	r, b = worker.call(t, "POST", url+"/complete", map[string]any{"reason": "Operator completed all requested paperwork", "version": int64(2)}, true)
	status(t, r, b, 200)
	r, b = manager.call(t, "POST", url+"/review", map[string]any{"decision": "approved", "reason": "All work has been checked by manager", "version": int64(3)}, true)
	status(t, r, b, 200)
	r, b = other.call(t, "POST", url+"/submit-final", map[string]any{"reason": "Attempt unrelated submit", "version": int64(3)}, true)
	status(t, r, b, 404)
	r, b = manager.call(t, "POST", url+"/submit-final", map[string]any{"reason": "Submit completed reviews to Kabagrenmin", "version": int64(3)}, true)
	status(t, r, b, 201)
	r, b = manager.call(t, "POST", url+"/submit-final", map[string]any{"reason": "Repeat same final approval submission", "version": int64(3)}, true)
	status(t, r, b, 409)
	r, b = lead.call(t, "GET", url+"/final-status", nil, false)
	status(t, r, b, 200)
	if !bytes.Contains(b, []byte(`"progressPercent":90`)) {
		t.Fatal("progress expected 90 pending final approval")
	}
	r, b = lead.call(t, "POST", url+"/decide-final", map[string]any{"decision": "approved", "reason": "Executive approval after review", "version": int64(1)}, true)
	status(t, r, b, 403)
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('br_kabagrenmin','urmin.disposisi.final.approve')`); err != nil {
		t.Fatal(err)
	}
	r, b = lead.call(t, "POST", url+"/decide-final", map[string]any{"decision": "approved", "reason": "Try without CSRF integrity", "version": int64(1)}, false)
	status(t, r, b, 403)
	// Grant Kabag permission to issuer as well to prove self-approval is denied.
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by) VALUES($1,'br_kabagrenmin','subbagren','unit','biasa','Prove self-approval blocked',$2)`, managerID, e.users["sa_r2d5"].id); err != nil {
		t.Fatal(err)
	}
	r, b = manager.call(t, "POST", url+"/decide-final", map[string]any{"decision": "approved", "reason": "Illicit self approval by original issuer", "version": int64(1)}, true)
	status(t, r, b, 403)
	r, b = lead.call(t, "POST", url+"/decide-final", map[string]any{"decision": "approved", "reason": "Kabagrenmin independently approves complete case", "version": int64(1)}, true)
	status(t, r, b, 200)
	r, b = lead.call(t, "POST", url+"/decide-final", map[string]any{"decision": "revision_requested", "reason": "Attempt to overturn immutable approval", "version": int64(1)}, true)
	status(t, r, b, 409)
	r, b = lead.call(t, "GET", url+"/final-status", nil, false)
	status(t, r, b, 200)
	if !bytes.Contains(b, []byte(`"progressPercent":100`)) {
		t.Fatal("progress must reach 100 only after final approval")
	}
	// Revoke grant immediately denies visibility/approval; no cached authorization.
	if _, err := e.db.Exec(ctx, `UPDATE sdl_access_grants SET revoked_at=now() WHERE user_id=$1`, leadID); err != nil {
		t.Fatal(err)
	}
	r, b = lead.call(t, "GET", "/api/v1/urmin/dispositions/leadership", nil, false)
	status(t, r, b, 403)
	r, b = lead.call(t, "GET", url+"/final-status", nil, false)
	status(t, r, b, 404)
}
