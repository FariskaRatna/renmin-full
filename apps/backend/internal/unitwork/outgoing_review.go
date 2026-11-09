package unitwork

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// R5F10: approval is a recorded managerial decision, NOT an electronic signature.
// No endpoint exists to set "signed" or "sent" until an authenticated PSrE
// signing result and a verified delivery transport are integrated.
type outgoingEvent struct {
	ID     string    `json:"id"`
	Action string    `json:"action"`
	Actor  string    `json:"actor"`
	Note   string    `json:"note"`
	At     time.Time `json:"at"`
}
type outgoingInput struct {
	Version int64  `json:"version"`
	Note    string `json:"note"`
}

func outgoingCanSubmit(stage string) bool { return stage == "draft" || stage == "rejected" }
func outgoingCanReview(stage string) bool { return stage == "submitted" }

func (a *API) outgoingManager(ctx context.Context, actor, classification string) (bool, error) {
	var yes bool
	// Wewenangnya lahir dari GRANT, bukan dari peran langsung. Sampai
	// 2026-11-01 query ini juga menuntut baris sdl_user_roles — tabel yang
	// hanya pernah diisi bootstrap Superadmin dan tidak pernah disentuh
	// cmd/seed-bagrenmin — sehingga fungsi ini mengembalikan false untuk SIAPA
	// PUN dan endpoint approve/reject tidak terjangkau sama sekali. Seluruh
	// pemeriksaan otorisasi lain di codebase ini (directives.isKabag,
	// executiveV2Access, access.EvaluateForUser) bersandar pada
	// sdl_access_grants; sdl_user_roles di tempat lain HANYA dibaca untuk
	// mendeteksi 'superadmin', dan di bawah ia tetap dipakai persis untuk itu.
	err := a.DB.QueryRow(ctx, `SELECT EXISTS(
 SELECT 1 FROM sdl_users u
 JOIN sdl_access_grants g ON g.user_id=u.id AND g.role_key='br_kabagrenmin'
 JOIN sdl_roles role ON role.role_key=g.role_key AND role.is_active
 JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key='urmin.surat_keluar.approve'
 JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key='urmin'
 WHERE u.id::text=$1 AND u.is_active AND NOT u.must_change_password
 AND g.unit_key='urmin' AND g.scope='unit' AND g.revoked_at IS NULL
 AND (g.expires_at IS NULL OR g.expires_at>now())
 AND (g.classification_limit='penting' OR $2='biasa')
 AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin'))`, actor, classification).Scan(&yes)
	return yes, err
}
func (a *API) outgoingWorkflow(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	row, err := a.urminregisterOwned(r.Context(), id, "read")
	if err != nil {
		urminregisterError(w, err)
		return
	}
	if row.Kind != "surat_keluar" {
		fail(w, 404, "not_found")
		return
	}
	var stage string
	var version int64
	err = a.DB.QueryRow(r.Context(), `SELECT stage,version FROM sdl_outgoing_workflows WHERE register_id::text=$1`, id).Scan(&stage, &version)
	if err != nil {
		sqlerr(w, err)
		return
	}
	canApprove, err := a.outgoingManager(r.Context(), who(r.Context()), row.Classification)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	canEdit, err := a.permit(r.Context(), "urmin", row.Classification, row.Owner, row.WorkRecordID, "edit")
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	events := []outgoingEvent{}
	rows, err := a.DB.Query(r.Context(), `SELECT e.id::text,e.event_key,u.display_name,e.note,e.created_at FROM sdl_outgoing_events e JOIN sdl_users u ON u.id=e.actor_id WHERE e.register_id::text=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 100`, id)
	if err != nil {
		sqlerr(w, err)
		return
	}
	for rows.Next() {
		var ev outgoingEvent
		if err = rows.Scan(&ev.ID, &ev.Action, &ev.Actor, &ev.Note, &ev.At); err != nil {
			break
		}
		events = append(events, ev)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		sqlerr(w, err)
		return
	}
	respond(w, 200, map[string]any{"status": stage, "version": version, "canSubmit": canEdit && outgoingCanSubmit(stage), "canReview": canApprove && outgoingCanReview(stage), "events": events, "signingAvailable": false, "emailDeliveryAvailable": false})
}
func (a *API) outgoingSubmit(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := a.urminregisterOwned(r.Context(), id, "edit")
	if err != nil {
		urminregisterError(w, err)
		return
	}
	if p.Kind != "surat_keluar" {
		fail(w, 404, "not_found")
		return
	}
	var v outgoingInput
	if !decode(w, r, &v) {
		return
	}
	if v.Version < 1 || len([]rune(strings.TrimSpace(v.Note))) > 500 {
		fail(w, 400, "invalid_input")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	// All file writers lock this same work row, ensuring submit and file updates serialize.
	var lock string
	err = tx.QueryRow(r.Context(), `SELECT id::text FROM sdl_unit_work_records WHERE id::text=$1 AND deleted_at IS NULL FOR UPDATE`, p.WorkRecordID).Scan(&lock)
	if err != nil {
		sqlerr(w, err)
		return
	}
	var recipient string
	err = tx.QueryRow(r.Context(), `SELECT COALESCE(fields->>'tujuan','') FROM sdl_urmin_registry WHERE id::text=$1 AND deleted_at IS NULL`, id).Scan(&recipient)
	if err != nil {
		sqlerr(w, err)
		return
	}
	if strings.TrimSpace(recipient) == "" {
		fail(w, 409, "recipient_required")
		return
	}
	var stage string
	var version int64
	err = tx.QueryRow(r.Context(), `SELECT stage,version FROM sdl_outgoing_workflows WHERE register_id::text=$1 FOR UPDATE`, id).Scan(&stage, &version)
	if err != nil {
		sqlerr(w, err)
		return
	}
	if version != v.Version || !outgoingCanSubmit(stage) {
		fail(w, 409, "workflow_state_changed")
		return
	}
	var pdfCount int
	err = tx.QueryRow(r.Context(), `SELECT count(*) FROM sdl_unit_work_files WHERE record_id::text=$1 AND removed_at IS NULL AND media_type='application/pdf' AND purpose='lampiran'`, p.WorkRecordID).Scan(&pdfCount)
	if err != nil {
		sqlerr(w, err)
		return
	}
	if pdfCount == 0 {
		fail(w, 409, "pdf_required_before_submit")
		return
	}
	contentHash, err := outgoingContentHash(r.Context(), tx, id, p.WorkRecordID)
	if err != nil {
		sqlerr(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE sdl_outgoing_workflows SET stage='submitted',version=version+1,content_sha256=$4,submitted_at=now(),approved_at=NULL,last_actor=$2::uuid,last_note=$3,updated_at=now() WHERE register_id::text=$1`, id, who(r.Context()), strings.TrimSpace(v.Note), contentHash)
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_outgoing_events(register_id,actor_id,event_key,note) VALUES($1::uuid,$2::uuid,'submitted',$3)`, id, who(r.Context()), strings.TrimSpace(v.Note))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		sqlerr(w, err)
		return
	}
	respond(w, 200, map[string]any{"ok": true, "status": "submitted"})
}
func (a *API) outgoingDecision(approved bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		p, err := a.urminregisterOwned(r.Context(), id, "read")
		if err != nil {
			urminregisterError(w, err)
			return
		}
		if p.Kind != "surat_keluar" {
			fail(w, 404, "not_found")
			return
		}
		authorized, err := a.outgoingManager(r.Context(), who(r.Context()), p.Classification)
		if err != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		if !authorized {
			fail(w, 403, "access_denied")
			return
		}
		var v outgoingInput
		if !decode(w, r, &v) {
			return
		}
		note := strings.TrimSpace(v.Note)
		if v.Version < 1 || len([]rune(note)) > 500 || (!approved && len([]rune(note)) < 8) {
			fail(w, 400, "invalid_input")
			return
		}
		tx, err := a.DB.Begin(r.Context())
		if err != nil {
			sqlerr(w, err)
			return
		}
		defer tx.Rollback(r.Context())
		var lock string
		err = tx.QueryRow(r.Context(), `SELECT id::text FROM sdl_unit_work_records WHERE id::text=$1 AND deleted_at IS NULL FOR UPDATE`, p.WorkRecordID).Scan(&lock)
		if err != nil {
			sqlerr(w, err)
			return
		}
		var stage string
		var contentHash string
		var version int64
		err = tx.QueryRow(r.Context(), `SELECT stage,version,COALESCE(content_sha256,'') FROM sdl_outgoing_workflows WHERE register_id::text=$1 FOR UPDATE`, id).Scan(&stage, &version, &contentHash)
		if errors.Is(err, pgx.ErrNoRows) {
			fail(w, 404, "not_found")
			return
		}
		if err != nil {
			sqlerr(w, err)
			return
		}
		if !outgoingCanReview(stage) || version != v.Version {
			fail(w, 409, "workflow_state_changed")
			return
		}
		currentHash, err := outgoingContentHash(r.Context(), tx, id, p.WorkRecordID)
		if err != nil {
			sqlerr(w, err)
			return
		}
		if currentHash != contentHash {
			fail(w, 409, "document_integrity_changed")
			return
		}

		next, key := "rejected", "rejected"
		if approved {
			next, key = "approved", "approved"
		}
		// Kedua pemakaian $2 WAJIB di-cast seragam. Tanpa cast, Postgres
		// mendeduksi varchar dari `stage=$2` dan text dari perbandingan di
		// dalam CASE, lalu menolak seluruh statement dengan
		// "inconsistent types deduced for parameter $2". Kegagalan itu muncul
		// sebagai 503 database_unavailable lewat sqlerr, sehingga persetujuan
		// dan penolakan surat keluar tidak pernah bisa berhasil. Mengecast
		// hanya sisi CASE tidak cukup: konfliknya justru antara kedua sisi.
		_, err = tx.Exec(r.Context(), `UPDATE sdl_outgoing_workflows SET stage=$2::varchar,version=version+1,approved_at=CASE WHEN $2::varchar='approved' THEN now() ELSE NULL END,last_actor=$3::uuid,last_note=$4,updated_at=now() WHERE register_id::text=$1`, id, next, who(r.Context()), note)
		if err == nil {
			_, err = tx.Exec(r.Context(), `INSERT INTO sdl_outgoing_events(register_id,actor_id,event_key,note) VALUES($1::uuid,$2::uuid,$3,$4)`, id, who(r.Context()), key, note)
		}
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			sqlerr(w, err)
			return
		}
		respond(w, 200, map[string]any{"ok": true, "status": next})
	}
}

var errOutgoingLocked = errors.New("outgoing_locked")

func lockOutgoingEditing(ctx context.Context, tx pgx.Tx, workID string) error {
	var locked string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM sdl_unit_work_records WHERE id::text=$1 AND deleted_at IS NULL FOR UPDATE`, workID).Scan(&locked); err != nil {
		return err
	}
	var stage string
	err := tx.QueryRow(ctx, `SELECT o.stage FROM sdl_urmin_registry s JOIN sdl_outgoing_workflows o ON o.register_id=s.id WHERE s.work_record_id::text=$1 AND s.kind='surat_keluar' AND s.deleted_at IS NULL`, workID).Scan(&stage)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if stage != "draft" && stage != "rejected" {
		return errOutgoingLocked
	}
	return nil
}

func outgoingContentHash(ctx context.Context, tx pgx.Tx, id, workID string) (string, error) {
	var code, title string
	var fields []byte
	err := tx.QueryRow(ctx, `SELECT ref_code,title,fields FROM sdl_urmin_registry WHERE id::text=$1 AND deleted_at IS NULL`, id).Scan(&code, &title, &fields)
	if err != nil {
		return "", err
	}
	var fieldMap map[string]any
	if err = json.Unmarshal(fields, &fieldMap); err != nil {
		return "", err
	}
	type fileDigest struct {
		ID   string `json:"id"`
		Hash string `json:"sha256"`
	}
	files := []fileDigest{}
	rows, err := tx.Query(ctx, `SELECT id::text,sha256 FROM sdl_unit_work_files WHERE record_id::text=$1 AND removed_at IS NULL AND purpose='lampiran' ORDER BY id`, workID)
	if err != nil {
		return "", err
	}
	for rows.Next() {
		var f fileDigest
		if err = rows.Scan(&f.ID, &f.Hash); err != nil {
			break
		}
		files = append(files, f)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(struct {
		Code   string         `json:"code"`
		Title  string         `json:"title"`
		Fields map[string]any `json:"fields"`
		Files  []fileDigest   `json:"files"`
	}{code, title, fieldMap, files})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}
