//go:build r2d5integration

package securitytest

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
)

// The R4A2 test uses the private ephemeral R2D5 database and real API router.
func verifyR4A2ReviewConsolidation(t *testing.T, e *testEnv, sa *browser) {
	ctx := context.Background()
	writer := e.createUser(t, ctx, "r4a2_author", false, true, false)
	reviewer := e.createUser(t, ctx, "r4a2_reviewer", false, true, false)
	outsider := e.createUser(t, ctx, "r4a2_outside", false, true, false)
	for _, u := range []struct{ id, unit string }{{writer.id, "subbagren"}, {reviewer.id, "subbagren"}, {outsider.id, "urmin"}} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,$2,true)`, u.id, u.unit); err != nil {
			t.Fatal(err)
		}
	}
	for _, role := range []string{"br_r4a2_writer", "br_r4a2_review"} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_roles(role_key,display_name) VALUES($1,$2)`, role, role); err != nil {
			t.Fatal(err)
		}
	}
	for _, g := range []struct{ id, role, scope string }{{writer.id, "br_r4a2_writer", "own"}, {reviewer.id, "br_r4a2_review", "unit"}} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by) VALUES($1,$2,'subbagren',$3,'biasa','R4A2 isolated regression grant',$4)`, g.id, g.role, g.scope, e.users["sa_r2d5"].id); err != nil {
			t.Fatal(err)
		}
	}
	for _, perm := range []string{"read", "create", "update", "submit"} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('br_r4a2_writer',$1)`, "subbagren.usulan."+perm); err != nil {
			t.Fatal(err)
		}
	}
	for _, perm := range []string{"read", "consolidate"} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('br_r4a2_review',$1)`, "subbagren.usulan."+perm); err != nil {
			t.Fatal(err)
		}
	}
	w := e.newBrowser(t)
	w.login(t, "r4a2_author", 200)
	rev := e.newBrowser(t)
	rev.login(t, "r4a2_reviewer", 200)
	x := e.newBrowser(t)
	x.login(t, "r4a2_outside", 200)
	url := "/api/v1/subbagren/usulan/"
	draft := map[string]any{"fiscalYear": 2027, "sourceUnit": "Subsatker Uji", "title": "Usulan test review dan anggaran", "outputTarget": "Dokumen internal untuk penelaahan dan audit", "proposedBudget": 25000000, "classification": "biasa", "reason": "Catatan awal perencanaan test R4A2"}
	r, b := w.call(t, "POST", url, draft, true)
	status(t, r, b, 201)
	var created struct {
		Item struct {
			ID      string `json:"id"`
			Version int64  `json:"version"`
		} `json:"item"`
	}
	if err := json.Unmarshal(b, &created); err != nil || created.Item.ID == "" {
		t.Fatalf("unexpected create response %s: %v", b, err)
	}
	id := created.Item.ID
	detail := url + id
	r, b = w.call(t, "POST", detail+"/submit", map[string]any{"version": 1, "reason": "Usulan awal diajukan untuk review internal"}, true)
	status(t, r, b, 200)
	reviewBody := map[string]any{"version": 2, "decision": "revision_requested", "reason": "Mohon lengkapi target output sesuai catatan"}
	r, b = rev.call(t, "POST", detail+"/review", reviewBody, true)
	status(t, r, b, 404) // Role review OFF.
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('br_r4a2_review','subbagren.usulan.review')`); err != nil {
		t.Fatal(err)
	}
	r, b = rev.call(t, "POST", detail+"/review", reviewBody, false)
	status(t, r, b, 403) // CSRF mandatory.
	r, b = x.call(t, "POST", detail+"/review", reviewBody, true)
	status(t, r, b, 404)
	r, b = sa.call(t, "GET", detail, nil, false)
	status(t, r, b, 403)
	// Even with an explicit review permission, the creator cannot review their own proposal.
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('br_r4a2_writer','subbagren.usulan.review')`); err != nil {
		t.Fatal(err)
	}
	r, b = w.call(t, "POST", detail+"/review", reviewBody, true)
	status(t, r, b, 403) // Creator cannot review own record.
	r, b = rev.call(t, "POST", detail+"/review", reviewBody, true)
	status(t, r, b, 200)
	r, b = rev.call(t, "POST", detail+"/review", reviewBody, true)
	status(t, r, b, 409)
	r, b = w.call(t, "GET", detail, nil, false)
	status(t, r, b, 200)
	if !bytes.Contains(b, []byte(`"reviewStatus":"revision_requested"`)) || !bytes.Contains(b, []byte(`"canRevise":true`)) {
		t.Fatalf("revision state missing: %s", b)
	}
	r, b = w.call(t, "POST", detail+"/resubmit", map[string]any{"version": 3, "reason": "Ajukan ulang setelah koreksi"}, true)
	status(t, r, b, 409) // Require actual revision.
	revision := map[string]any{"version": 3, "fiscalYear": 2027, "sourceUnit": "Subsatker Uji", "title": "Usulan test hasil revisi", "outputTarget": "Dokumen diperbaiki agar sesuai hasil evaluasi", "proposedBudget": 30000000, "classification": "penting", "reason": "Revisi dan peningkatan klasifikasi untuk test"}
	r, b = w.call(t, "PATCH", detail+"/revision", revision, true)
	status(t, r, b, 403) // New important class prohibited.
	revision["classification"] = "biasa"
	r, b = rev.call(t, "PATCH", detail+"/revision", revision, true)
	status(t, r, b, 404)
	r, b = w.call(t, "PATCH", detail+"/revision", revision, true)
	status(t, r, b, 200)
	r, b = w.call(t, "PATCH", detail+"/revision", revision, true)
	status(t, r, b, 409) // Stale version.
	r, b = rev.call(t, "POST", detail+"/review", map[string]any{"version": 4, "decision": "approved", "reason": "Persetujuan internal sebelum submit ulang"}, true)
	status(t, r, b, 409)
	r, b = w.call(t, "POST", detail+"/resubmit", map[string]any{"version": 4, "reason": "Mengajukan ulang usulan yang telah direvisi"}, true)
	status(t, r, b, 200)
	r, b = rev.call(t, "POST", detail+"/review", map[string]any{"version": 5, "decision": "approved", "reason": "Target internal telah ditelaah dan memenuhi kebutuhan"}, true)
	status(t, r, b, 200)
	r, b = rev.call(t, "POST", detail+"/review", map[string]any{"version": 6, "decision": "approved", "reason": "Keputusan kedua ini tidak boleh terjadi"}, true)
	status(t, r, b, 409)
	r, b = w.call(t, "PATCH", detail+"/revision", revision, true)
	status(t, r, b, 409)
	r, b = rev.call(t, "GET", url+"consolidation?year=2027", nil, false)
	status(t, r, b, 200)
	if !bytes.Contains(b, []byte(`"totalBudget":"30000000"`)) || !bytes.Contains(b, []byte(`"basis":"approved_internal_only"`)) {
		t.Fatalf("unexpected summary: %s", b)
	}
	r, b = w.call(t, "GET", url+"consolidation?year=2027", nil, false)
	status(t, r, b, 403)
	r, b = x.call(t, "GET", url+"consolidation?year=2027", nil, false)
	status(t, r, b, 403)
	r, b = rev.call(t, "GET", url+"consolidation?year=1900", nil, false)
	status(t, r, b, 400)
	r, b = rev.call(t, "GET", detail, nil, false)
	status(t, r, b, 200)
	if !bytes.Contains(b, []byte(`"reviewStatus":"approved"`)) || !bytes.Contains(b, []byte(`"action":"resubmitted"`)) {
		t.Fatalf("review history missing: %s", b)
	}
	var cnt int
	if err := e.db.QueryRow(ctx, `SELECT COUNT(*) FROM sdl_subbagren_review_events WHERE proposal_id=$1`, id).Scan(&cnt); err != nil || cnt != 4 {
		t.Fatalf("expected 4 audit events, got %d: %v", cnt, err)
	}
	// A revoked reviewer grant cannot read/consolidate, despite cached UI and session.
	if _, err := e.db.Exec(ctx, `UPDATE sdl_access_grants SET revoked_at=now() WHERE user_id=$1 AND role_key='br_r4a2_review'`, reviewer.id); err != nil {
		t.Fatal(err)
	}
	r, b = rev.call(t, "GET", detail, nil, false)
	status(t, r, b, 404)
	r, b = rev.call(t, "GET", url+"consolidation?year=2027", nil, false)
	status(t, r, b, 403)
}
