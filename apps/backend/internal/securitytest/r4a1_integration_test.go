//go:build r2d5integration

package securitytest

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
)

// Uses the existing R2D5 private PostgreSQL and real router. No live SDL data.
func verifyR4A1Usulan(t *testing.T, e *testEnv, sa *browser) {
	ctx := context.Background()
	writer := e.createUser(t, ctx, "r4a1_writer", false, true, false)
	stranger := e.createUser(t, ctx, "r4a1_stranger", false, true, false)
	for _, u := range []struct{ id, unit string }{{writer.id, "subbagren"}, {stranger.id, "urmin"}} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,$2,true)`, u.id, u.unit); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_roles(role_key,display_name) VALUES('br_r4a1_test','R4A1 Test Role')`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by) VALUES($1,'br_r4a1_test','subbagren','own','biasa','Isolated R4A1 grant only',$2)`, writer.id, e.users["sa_r2d5"].id); err != nil {
		t.Fatal(err)
	}
	w := e.newBrowser(t)
	w.login(t, "r4a1_writer", 200)
	x := e.newBrowser(t)
	x.login(t, "r4a1_stranger", 200)
	draft := map[string]any{"fiscalYear": 2027, "sourceUnit": "Subsatker Dummy", "title": "Pengembangan administrasi internal", "outputTarget": "Dokumen kegiatan operasional internal", "proposedBudget": int64(150000000), "classification": "biasa", "reason": "Mencatat usulan dummy untuk audit"}
	url := "/api/v1/subbagren/usulan/"
	r, b := w.call(t, "POST", url, draft, true)
	status(t, r, b, 403) // No role permission automatically granted.
	r, b = sa.call(t, "GET", url, nil, false)
	status(t, r, b, 403)
	r, b = x.call(t, "POST", url, draft, true)
	status(t, r, b, 403)
	for _, perm := range []string{"subbagren.usulan.read", "subbagren.usulan.create", "subbagren.usulan.update"} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('br_r4a1_test',$1)`, perm); err != nil {
			t.Fatal(err)
		}
	}
	r, b = w.call(t, "POST", url, draft, false)
	status(t, r, b, 403) // CSRF/Origin required.
	invalid := map[string]any{}
	for k, v := range draft {
		invalid[k] = v
	}
	invalid["proposedBudget"] = int64(-100)
	r, b = w.call(t, "POST", url, invalid, true)
	status(t, r, b, 400)
	important := map[string]any{}
	for k, v := range draft {
		important[k] = v
	}
	important["classification"] = "penting"
	r, b = w.call(t, "POST", url, important, true)
	status(t, r, b, 403)
	r, b = w.call(t, "POST", url, draft, true)
	status(t, r, b, 201)
	var created struct {
		Item struct {
			ID      string `json:"id"`
			Version int64  `json:"version"`
		} `json:"item"`
	}
	if json.Unmarshal(b, &created) != nil || created.Item.ID == "" || created.Item.Version != 1 {
		t.Fatalf("unexpected created proposal: %s", b)
	}
	id := created.Item.ID
	detail := url + id
	r, b = x.call(t, "GET", detail, nil, false)
	status(t, r, b, 404)
	r, b = w.call(t, "GET", detail, nil, false)
	status(t, r, b, 200)
	if !bytes.Contains(b, []byte(`"canUpdate":true`)) {
		t.Fatal("writer should edit its own draft")
	}
	r, b = w.call(t, "GET", url, nil, false)
	status(t, r, b, 200)
	if !bytes.Contains(b, []byte(id)) {
		t.Fatal("created draft absent from writer list")
	}
	r, b = w.call(t, "PATCH", detail, map[string]any{"version": 10, "fiscalYear": 2027, "sourceUnit": "Subsatker Dummy", "title": "Usulan berubah untuk audit", "outputTarget": "Dokumen keluaran yang baru dibuat", "proposedBudget": 1000000, "classification": "biasa", "reason": "Perbarui draft dummy untuk test"}, true)
	status(t, r, b, 409)
	update := map[string]any{"version": 1, "fiscalYear": 2027, "sourceUnit": "Subsatker Dummy", "title": "Usulan kegiatan hasil koreksi", "outputTarget": "Dokumen keluaran kegiatan internal", "proposedBudget": int64(200000000), "classification": "biasa", "reason": "Perubahan estimasi sesuai telaah awal"}
	r, b = w.call(t, "PATCH", detail, update, true)
	status(t, r, b, 200)
	r, b = w.call(t, "POST", detail+"/submit", map[string]any{"version": 2, "reason": "Ajukan usulan internal untuk penelaahan"}, true)
	status(t, r, b, 404) // Permission not yet enabled.
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('br_r4a1_test','subbagren.usulan.submit')`); err != nil {
		t.Fatal(err)
	}
	r, b = w.call(t, "POST", detail+"/submit", map[string]any{"version": 2, "reason": "Ajukan usulan internal untuk penelaahan"}, true)
	status(t, r, b, 200)
	r, b = w.call(t, "PATCH", detail, update, true)
	status(t, r, b, 404) // Submitted = immutable in R4A1.
	r, b = w.call(t, "GET", detail, nil, false)
	status(t, r, b, 200)
	if !bytes.Contains(b, []byte(`"action":"submitted"`)) {
		t.Fatal("immutable submission history missing")
	}
	var n int
	if err := e.db.QueryRow(ctx, `SELECT COUNT(*) FROM sdl_subbagren_proposal_history WHERE proposal_id=$1`, id).Scan(&n); err != nil || n != 3 {
		t.Fatalf("expected 3 append-only history entries, got %d: %v", n, err)
	}
	if _, err := e.db.Exec(ctx, `UPDATE sdl_access_grants SET revoked_at=now() WHERE user_id=$1 AND role_key='br_r4a1_test'`, writer.id); err != nil {
		t.Fatal(err)
	}
	r, b = w.call(t, "GET", detail, nil, false)
	status(t, r, b, 404)
}
