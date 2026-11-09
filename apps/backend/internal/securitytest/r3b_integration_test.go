//go:build r2d5integration

package securitytest

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"testing"
)

func verifyR3BSecureDistribution(t *testing.T, e *testEnv, op, outsider, sa *browser) {
	ctx := context.Background()
	perms := []string{"urmin.surat_masuk.attach", "urmin.surat_masuk.download", "urmin.surat_masuk.distribute", "urmin.distribusi.receive"}
	for _, p := range perms {
		if _, err := e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('operator',$1) ON CONFLICT DO NOTHING`, p); err != nil {
			t.Fatal(err)
		}
	}
	var id string
	payload := map[string]any{"letterNumber": "SDL-R3B-TEST-001", "sender": "Test Sekretariat", "letterDate": "2026-10-18", "receivedDate": "2026-10-18", "subject": "R3B isolated attachment and distribution test", "classification": "biasa", "reason": "R3B verification only in isolated database"}
	r, body := op.call(t, "POST", "/api/v1/urmin/surat-masuk/", payload, true)
	status(t, r, body, 201)
	var created struct {
		Item struct {
			ID      string `json:"id"`
			Version int64  `json:"version"`
		} `json:"item"`
	}
	if json.Unmarshal(body, &created) != nil {
		t.Fatal("missing response")
	}
	id = created.Item.ID
	r, body = op.call(t, "POST", "/api/v1/urmin/surat-masuk/"+id+"/register", map[string]any{"reason": "Register for R3B security integration", "version": created.Item.Version}, true)
	status(t, r, body, 200)
	r, body = sa.call(t, "GET", "/api/v1/urmin/surat-masuk/"+id+"/attachments", nil, false)
	status(t, r, body, 403)
	r, body = outsider.call(t, "GET", "/api/v1/urmin/surat-masuk/"+id+"/attachments", nil, false)
	status(t, r, body, 404)
	r, body = op.call(t, "POST", "/api/v1/urmin/surat-masuk/"+id+"/distributions", map[string]any{"unit": "subbagren", "recipientId": e.users["outsider_r2d5"].id, "reason": "Deliver document only to assigned Subbagren user"}, true)
	status(t, r, body, 201)
	var delivery struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(body, &delivery) != nil || delivery.ID == "" {
		t.Fatal("missing delivery id")
	}
	r, body = op.call(t, "POST", "/api/v1/urmin/distribution-inbox/"+delivery.ID+"/receive", map[string]any{"reason": "Sender must not acknowledge recipient inbox"}, true)
	status(t, r, body, 404)
	r, body = op.call(t, "POST", "/api/v1/urmin/surat-masuk/"+id+"/distributions", map[string]any{"unit": "subbagren", "recipientId": e.users["outsider_r2d5"].id, "reason": "Duplicate pending delivery forbidden"}, true)
	status(t, r, body, 409)
	other := e.createUser(t, ctx, "other_r3b", false, true, false)
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,'subbagren',true)`, other.id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.db.Exec(ctx, `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by) VALUES($1,'operator','subbagren','unit','biasa','same-unit unaddressed access must be denied',$2)`, other.id, e.users["sa_r2d5"].id); err != nil {
		t.Fatal(err)
	}
	otherBrowser := e.newBrowser(t)
	otherBrowser.login(t, "other_r3b", 200)
	r, body = otherBrowser.call(t, "GET", "/api/v1/urmin/distribution-inbox/", nil, false)
	status(t, r, body, 200)
	if bytes.Contains(body, []byte(delivery.ID)) {
		t.Fatal("same-unit, unaddressed user saw delivery")
	}
	r, body = otherBrowser.call(t, "GET", "/api/v1/urmin/surat-masuk/"+id+"/attachments", nil, false)
	status(t, r, body, 404)
	r, body = outsider.call(t, "GET", "/api/v1/urmin/distribution-inbox/", nil, false)
	status(t, r, body, 200)
	if !bytes.Contains(body, []byte(delivery.ID)) {
		t.Fatal("addressed delivery missing from inbox")
	}
	r, body = outsider.call(t, "GET", "/api/v1/urmin/surat-masuk/"+id, nil, false)
	status(t, r, body, 404)
	r, body = outsider.call(t, "POST", "/api/v1/urmin/distribution-inbox/"+delivery.ID+"/receive", map[string]any{"reason": "Missing CSRF must not accept receipt"}, false)
	status(t, r, body, 403)
	r, body = outsider.call(t, "POST", "/api/v1/urmin/distribution-inbox/"+delivery.ID+"/receive", map[string]any{"reason": "Received and acknowledged for internal processing"}, true)
	status(t, r, body, 200)
	r, body = outsider.call(t, "POST", "/api/v1/urmin/distribution-inbox/"+delivery.ID+"/receive", map[string]any{"reason": "A replay confirmation should be rejected"}, true)
	status(t, r, body, 409)
	r, body = sa.call(t, "POST", "/api/v1/urmin/distribution-inbox/"+delivery.ID+"/receive", map[string]any{"reason": "Superadmin forbidden access to operational inbox"}, true)
	status(t, r, body, 403)
	r, body = op.call(t, "GET", "/api/v1/urmin/surat-masuk/"+id+"/distributions", nil, false)
	status(t, r, body, 200)
	if !bytes.Contains(body, []byte(`"status":"received"`)) {
		t.Fatal("acknowledgement not persisted")
	}
	// Multipart upload: invalid content type must be rejected, a valid PDF can be downloaded.
	upload := func(name string, data []byte) (*http.Response, []byte) {
		t.Helper()
		var b bytes.Buffer
		writer := multipart.NewWriter(&b)
		file, err := writer.CreateFormFile("file", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.Write(data); err != nil {
			t.Fatal(err)
		}
		if err = writer.WriteField("reason", "Upload document evidence for R3B security tests"); err != nil {
			t.Fatal(err)
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		req, err := http.NewRequest("POST", op.endpoint+"/api/v1/urmin/surat-masuk/"+id+"/attachments", &b)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("X-CSRF-Token", op.token)
		req.Header.Set("Origin", origin)
		resp, err := op.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		dataOut := new(bytes.Buffer)
		_, _ = dataOut.ReadFrom(resp.Body)
		return resp, dataOut.Bytes()
	}
	r, body = upload("fake.pdf", []byte("bad"))
	status(t, r, body, 400)
	r, body = upload("safe.pdf", []byte("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"))
	status(t, r, body, 201)
	var uploaded struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(body, &uploaded) != nil || uploaded.ID == "" {
		t.Fatal("missing attachment id")
	}
	path := "/api/v1/urmin/surat-masuk/" + id + "/attachments/" + uploaded.ID + "/download"
	r, body = outsider.call(t, "GET", path, nil, false)
	status(t, r, body, 200)
	if r.Header.Get("Content-Disposition") == "" || r.Header.Get("Content-Type") != "application/octet-stream" {
		t.Fatal("download lacks safe headers")
	}
	r, body = sa.call(t, "GET", path, nil, false)
	status(t, r, body, 403)
	// Revoked grant immediately removes recipient access to inbox and attachment.
	if _, err := e.db.Exec(ctx, `UPDATE sdl_access_grants SET revoked_at=now() WHERE user_id=$1`, e.users["outsider_r2d5"].id); err != nil {
		t.Fatal(err)
	}
	r, body = outsider.call(t, "GET", path, nil, false)
	status(t, r, body, 404)
	r, body = outsider.call(t, "GET", "/api/v1/urmin/distribution-inbox/", nil, false)
	status(t, r, body, 200)
	if bytes.Contains(body, []byte(delivery.ID)) {
		t.Fatal("revoked recipient still sees distribution")
	}
}
