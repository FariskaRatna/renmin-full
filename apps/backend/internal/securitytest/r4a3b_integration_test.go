//go:build r2d5integration

package securitytest

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

// Multipart calls carry the exact CSRF protections as JSON calls.
func proofUpload(t *testing.T, b *browser, realID, name string, data []byte, csrf bool) (*http.Response, []byte) {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	if err := writer.WriteField("reason", "Bukti transaksi harus ditelaah independen"); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest("POST", b.endpoint+"/api/v1/subbagren/budget/realisasi/"+realID+"/evidence", &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if csrf {
		req.Header.Set("Origin", origin)
		req.Header.Set("X-CSRF-Token", b.token)
	}
	resp, err := b.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		t.Fatal(err)
	}
	return resp, body
}
func proofPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
func approvedProof(t *testing.T, maker, checker *browser, realID string) string {
	t.Helper()
	r, b := proofUpload(t, maker, realID, "bukti.png", proofPNG(t), true)
	status(t, r, b, 201)
	var got struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(b, &got); err != nil || got.ID == "" {
		t.Fatalf("upload response %s %v", b, err)
	}
	url := "/api/v1/subbagren/budget/realisasi/" + realID + "/evidence/" + got.ID + "/review"
	r, b = checker.call(t, "POST", url, map[string]any{"version": 1, "decision": "approved", "reason": "Bukti cocok dengan transaksi dan dokumen sumber"}, true)
	status(t, r, b, 200)
	return got.ID
}

// Runs after 09h against its isolated, deterministic fixture; never touches local Mac data.
func verifyR4A3BProof(t *testing.T, e *testEnv, sa *browser) {
	ctx := context.Background()
	maker := e.newBrowser(t)
	maker.login(t, "r4a3_maker", 200)
	outsider := e.newBrowser(t)
	outsider.login(t, "r4a3_outside", 200)
	// Role grants revoked after 09h. Create a new independent checker within ephemeral DB only.
	checker := e.createUser(t, ctx, "r4a3b_checker", false, true, false)
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,'subbagren',true)`, checker.id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_roles(role_key,display_name) VALUES('br_r4a3b_checker','R4A3B independent checker')`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by) VALUES($1,'br_r4a3b_checker','subbagren','unit','biasa','Financial proof verification test',$2)`, checker.id, e.users["sa_r2d5"].id); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"subbagren.usulan.read", "subbagren.anggaran.read", "subbagren.anggaran.bukti.read", "subbagren.anggaran.bukti.verify", "subbagren.anggaran.reconcile", "subbagren.anggaran.realisasi.verify"} {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('br_r4a3b_checker',$1)`, key); err != nil {
			t.Fatal(err)
		}
	}
	check := e.newBrowser(t)
	check.login(t, "r4a3b_checker", 200)
	var realID string
	if err := e.db.QueryRow(ctx, `SELECT id::text FROM sdl_subbagren_realisasi WHERE status='pending' ORDER BY created_at DESC LIMIT 1`).Scan(&realID); err != nil {
		t.Fatal(err)
	}
	root := "/api/v1/subbagren/budget/"
	r, b := proofUpload(t, maker, realID, "fake.png", []byte("<script>bad file</script>"), true)
	status(t, r, b, 400)
	r, b = proofUpload(t, maker, realID, "file.png", proofPNG(t), false)
	status(t, r, b, 403)
	r, b = proofUpload(t, outsider, realID, "file.png", proofPNG(t), true)
	status(t, r, b, 404)
	// Already approved file from 09h cannot be overwritten or replaced.
	r, b = proofUpload(t, maker, realID, "file.png", proofPNG(t), true)
	status(t, r, b, 409)
	var proofID string
	if err := e.db.QueryRow(ctx, `SELECT id::text FROM sdl_subbagren_evidence WHERE realisasi_id=$1 AND status='approved'`, realID).Scan(&proofID); err != nil {
		t.Fatal(err)
	}
	path := root + "realisasi/" + realID + "/evidence/" + proofID + "/download"
	r, b = outsider.call(t, "GET", path, nil, false)
	status(t, r, b, 404)
	r, b = sa.call(t, "GET", path, nil, false)
	status(t, r, b, 403)
	r, b = check.call(t, "GET", path, nil, false)
	status(t, r, b, 200)
	if !bytes.Equal(b, proofPNG(t)) {
		t.Fatal("file body changed")
	}
	if !strings.Contains(r.Header.Get("Content-Disposition"), "attachment") || r.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("unsafe download headers")
	}
	// Even granting review permission cannot permit an uploader/maker to self-approve.
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('br_r4a3_maker','subbagren.anggaran.bukti.verify') ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	r, b = maker.call(t, "POST", root+"realisasi/"+realID+"/evidence/"+proofID+"/review", map[string]any{"version": 2, "decision": "rejected", "reason": "Should be denied for maker"}, true)
	status(t, r, b, 403) // Independent reviewer required even if authorized.
	r, b = check.call(t, "POST", root+"realisasi/"+realID+"/evidence/"+proofID+"/review", map[string]any{"version": 1, "decision": "approved", "reason": "Replay approval is prohibited"}, true)
	status(t, r, b, 409)
	r, b = check.call(t, "GET", root+"reconciliation?year=2026", nil, false)
	status(t, r, b, 200)
	if !bytes.Contains(b, []byte(`"basis":"verified_only_scoped"`)) || !bytes.Contains(b, []byte(`"officialLRA":false`)) {
		t.Fatalf("reconciliation incorrectly official: %s", b)
	}
	r, b = outsider.call(t, "GET", root+"reconciliation?year=2026", nil, false)
	status(t, r, b, 404)
	// Mutated evidence bytes must fail SHA-256 checks before finance approval or download.
	if _, err := e.db.Exec(ctx, `UPDATE sdl_subbagren_evidence SET body=set_byte(body,25,(get_byte(body,25)+1)%256) WHERE id=$1`, proofID); err != nil {
		t.Fatal(err)
	}
	r, b = check.call(t, "GET", path, nil, false)
	status(t, r, b, 503)
	r, b = check.call(t, "POST", root+"realisasi/"+realID+"/review", map[string]any{"version": 1, "decision": "verified", "reason": "Should reject corrupted proof"}, true)
	status(t, r, b, 409)
	// Source authority revoked -> finance & evidence access denied in same session.
	if _, err := e.db.Exec(ctx, `UPDATE sdl_access_grants SET revoked_at=now() WHERE user_id=$1 AND role_key='br_r4a3b_checker'`, checker.id); err != nil {
		t.Fatal(err)
	}
	r, b = check.call(t, "GET", path, nil, false)
	status(t, r, b, 404)
}
