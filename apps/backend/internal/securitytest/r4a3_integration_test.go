//go:build r2d5integration

package securitytest

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
)

// Tests run on exclusively ephemeral isolated PostgreSQL, never on the Mac DB.
func verifyR4A3Budget(t *testing.T, e *testEnv, sa *browser) {
	ctx := context.Background()
	maker := e.createUser(t, ctx, "r4a3_maker", false, true, false)
	checker := e.createUser(t, ctx, "r4a3_checker", false, true, false)
	outside := e.createUser(t, ctx, "r4a3_outside", false, true, false)
	for _, u := range []struct{ id, unit string }{{maker.id, "subbagren"}, {checker.id, "subbagren"}, {outside.id, "urmin"}} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,$2,true)`, u.id, u.unit); err != nil {
			t.Fatal(err)
		}
	}
	for _, role := range []string{"br_r4a3_maker", "br_r4a3_checker"} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_roles(role_key,display_name) VALUES($1,$2)`, role, role); err != nil {
			t.Fatal(err)
		}
	}
	for _, v := range []struct{ id, role, scope string }{{maker.id, "br_r4a3_maker", "own"}, {checker.id, "br_r4a3_checker", "unit"}} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by) VALUES($1,$2,'subbagren',$3,'biasa','R4A3 independent maker checker security test',$4)`, v.id, v.role, v.scope, e.users["sa_r2d5"].id); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{"subbagren.usulan.read", "subbagren.usulan.create", "subbagren.usulan.submit", "subbagren.anggaran.read", "subbagren.anggaran.pagu.register", "subbagren.anggaran.realisasi.record", "subbagren.anggaran.bukti.upload", "subbagren.anggaran.bukti.read"} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('br_r4a3_maker',$1)`, p); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{"subbagren.usulan.read", "subbagren.usulan.review", "subbagren.anggaran.read", "subbagren.anggaran.pagu.verify", "subbagren.anggaran.realisasi.verify", "subbagren.anggaran.bukti.verify", "subbagren.anggaran.bukti.read", "subbagren.anggaran.reconcile"} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('br_r4a3_checker',$1)`, p); err != nil {
			t.Fatal(err)
		}
	}
	m := e.newBrowser(t)
	m.login(t, "r4a3_maker", 200)
	v := e.newBrowser(t)
	v.login(t, "r4a3_checker", 200)
	x := e.newBrowser(t)
	x.login(t, "r4a3_outside", 200)
	root := "/api/v1/subbagren/usulan/"
	create := map[string]any{"fiscalYear": 2026, "sourceUnit": "Kebutuhan Test R4A3", "title": "Kebutuhan Pengujian Realisasi", "outputTarget": "Hasil kegiatan tahunan untuk audit internal", "proposedBudget": 100000000, "classification": "biasa", "reason": "Registrasi awal proposal untuk pengujian pagu"}
	r, b := m.call(t, "POST", root, create, true)
	status(t, r, b, 201)
	var created struct {
		Item struct {
			ID string `json:"id"`
		} `json:"item"`
	}
	if err := json.Unmarshal(b, &created); err != nil || created.Item.ID == "" {
		t.Fatalf("create response: %s %v", b, err)
	}
	id := created.Item.ID
	r, b = m.call(t, "POST", root+id+"/submit", map[string]any{"version": 1, "reason": "Diajukan untuk review sebelum pagu"}, true)
	status(t, r, b, 200)
	budget := "/api/v1/subbagren/budget/"
	paguReq := map[string]any{"proposalId": id, "amount": 90000000, "authorizationNumber": "DIPA-TEST-2026-001", "authorizationIssuer": "Instansi Penerbit Dokumen", "authorizationDate": "2026-10-19", "reason": "Pencatatan referensi dokumen pagu test"}
	r, b = m.call(t, "POST", budget+"pagu", paguReq, true)
	status(t, r, b, 409) // Internal review isn't budget authorization.
	r, b = v.call(t, "POST", root+id+"/review", map[string]any{"version": 2, "decision": "approved", "reason": "Usulan disetujui untuk diproses secara internal"}, true)
	status(t, r, b, 200)
	r, b = m.call(t, "POST", budget+"pagu", paguReq, false)
	status(t, r, b, 403)
	r, b = x.call(t, "POST", budget+"pagu", paguReq, true)
	status(t, r, b, 404)
	r, b = sa.call(t, "GET", budget+"?year=2026", nil, false)
	status(t, r, b, 403)
	r, b = m.call(t, "POST", budget+"pagu", paguReq, true)
	status(t, r, b, 201)
	var reg struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(b, &reg); err != nil || reg.ID == "" {
		t.Fatalf("pagu ID: %s %v", b, err)
	}
	r, b = m.call(t, "POST", budget+"pagu", paguReq, true)
	status(t, r, b, 409)
	review := map[string]any{"version": 1, "decision": "verified", "reason": "Bukti referensi pagu diverifikasi independen"}
	r, b = m.call(t, "POST", budget+"pagu/"+reg.ID+"/review", review, true)
	status(t, r, b, 404) // Permission OFF by default.
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('br_r4a3_maker','subbagren.anggaran.pagu.verify')`); err != nil {
		t.Fatal(err)
	}
	r, b = m.call(t, "POST", budget+"pagu/"+reg.ID+"/review", review, true)
	status(t, r, b, 403) // Cannot self-verify even if granted.
	r, b = v.call(t, "POST", budget+"pagu/"+reg.ID+"/review", review, true)
	status(t, r, b, 200)
	r, b = v.call(t, "POST", budget+"pagu/"+reg.ID+"/review", review, true)
	status(t, r, b, 409)
	transaction := map[string]any{"paguId": reg.ID, "amount": 60000000, "transactionDate": "2026-10-19", "evidenceReference": "BKU-R4A3-TEST-0001", "description": "Pembayaran kegiatan hasil pengujian integrasi", "reason": "Input transaksi untuk verifikasi independen"}
	r, b = m.call(t, "POST", budget+"realisasi", transaction, true)
	status(t, r, b, 201)
	var first struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(b, &first); err != nil || first.ID == "" {
		t.Fatalf("realisasi ID: %s %v", b, err)
	}
	r, b = v.call(t, "GET", budget+"?year=2026", nil, false)
	status(t, r, b, 200)
	if !bytes.Contains(b, []byte(`"realizationVerified":"0"`)) || !bytes.Contains(b, []byte(`"paguVerified":"90000000"`)) {
		t.Fatalf("unverified incorrectly counted: %s", b)
	}
	r, b = v.call(t, "POST", budget+"realisasi/"+first.ID+"/review", review, true)
	status(t, r, b, 409) // New verification requires independently approved uploaded proof.
	approvedProof(t, m, v, first.ID)
	r, b = v.call(t, "POST", budget+"realisasi/"+first.ID+"/review", review, true)
	status(t, r, b, 200)
	r, b = v.call(t, "POST", budget+"realisasi/"+first.ID+"/review", review, true)
	status(t, r, b, 409)
	transaction["amount"] = 40000000
	transaction["evidenceReference"] = "BKU-R4A3-TEST-0002"
	r, b = m.call(t, "POST", budget+"realisasi", transaction, true)
	status(t, r, b, 201)
	var second struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(b, &second); err != nil || second.ID == "" {
		t.Fatalf("realisasi ID2: %s %v", b, err)
	}
	approvedProof(t, m, v, second.ID)
	r, b = v.call(t, "POST", budget+"realisasi/"+second.ID+"/review", review, true)
	status(t, r, b, 409) // 60m + 40m > 90m, even with approved evidence.
	r, b = v.call(t, "GET", budget+"?year=2026", nil, false)
	status(t, r, b, 200)
	if !bytes.Contains(b, []byte(`"realizationVerified":"60000000"`)) || !bytes.Contains(b, []byte(`"remaining":"30000000"`)) || !bytes.Contains(b, []byte(`"basis":"verified_only"`)) {
		t.Fatalf("bad verified totals: %s", b)
	}
	r, b = x.call(t, "GET", budget+"?year=2026", nil, false)
	status(t, r, b, 403)
	r, b = v.call(t, "GET", budget+"?year=1900", nil, false)
	status(t, r, b, 400)
	// Revoked grants must take effect without logout/session refresh.
	if _, err := e.db.Exec(ctx, `UPDATE sdl_access_grants SET revoked_at=now() WHERE user_id=$1 AND role_key='br_r4a3_checker'`, checker.id); err != nil {
		t.Fatal(err)
	}
	r, b = v.call(t, "GET", budget+"?year=2026", nil, false)
	status(t, r, b, 403)
	r, b = v.call(t, "POST", budget+"realisasi/"+second.ID+"/review", map[string]any{"version": 1, "decision": "rejected", "reason": "Ditolak setelah grant dicabut"}, true)
	status(t, r, b, 404)
	var count int
	if err := e.db.QueryRow(ctx, `SELECT count(*) FROM sdl_subbagren_budget_events WHERE subject_type IN ('pagu','realisasi') AND subject_id IN ($1::uuid,$2::uuid,$3::uuid)`, reg.ID, first.ID, second.ID).Scan(&count); err != nil || count != 5 {
		t.Fatalf("expected 5 immutable events, got %d: %v", count, err)
	}
}
