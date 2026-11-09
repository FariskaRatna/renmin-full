package unitwork

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"path"
	"siera-delta-lima/backend/internal/devdemo"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// R5A is a small, real four-unit CRUD surface. It intentionally uses existing
// identity and active unit grants, not new permissions or automatic grants.
type API struct{ DB *pgxpool.Pool }
type actorKey struct{}

func WithActor(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, actorKey{}, id)
}
func who(ctx context.Context) string { s, _ := ctx.Value(actorKey{}).(string); return s }
func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func fail(w http.ResponseWriter, status int, code string) {
	respond(w, status, map[string]string{"error": code})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 16384)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if d.Decode(v) != nil {
		fail(w, 400, "invalid_input")
		return false
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		fail(w, 400, "invalid_input")
		return false
	}
	return true
}
func lenOK(v string, min, max int) bool {
	n := len([]rune(strings.TrimSpace(v)))
	return n >= min && n <= max
}
func allowedUnit(u string) bool {
	switch u {
	case "urmin", "subbagren", "subbagsumda", "subbagbinfung":
		return true
	}
	return false
}
func sqlerr(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
	} else {
		fail(w, 503, "database_unavailable")
	}
}

// PermitRead adalah pintu baca Engine B untuk paket lain (R5H5): paket urmin
// memakainya untuk menanyakan apakah seorang aktor boleh membaca sebuah entri
// register Urmin. Kunci context aktor berbeda per paket, jadi aktornya
// diberikan eksplisit lalu dipasang di context milik paket ini.
func PermitRead(ctx context.Context, db *pgxpool.Pool, actorID, unit, classification, owner, recordID string) (bool, error) {
	a := &API{DB: db}
	return a.permit(WithActor(ctx, actorID), unit, classification, owner, recordID, "read")
}

// Existing live scope/classification grants are the operational boundary.
// A grantee with own scope sees own records; assigned scope sees assigned tasks;
// unit scope sees records for the unit. No global fallback and no superadmin.
func (a *API) permit(ctx context.Context, unit, classification, owner, recordID, action string) (bool, error) {
	if allowedUnit(unit) && (classification == "biasa" || classification == "penting") {
		demo, err := devdemo.Superadmin(ctx, a.DB, who(ctx))
		if err != nil || demo {
			return false, err // R5F20B: operational deny, including demo Superadmin
		}
	}
	rows, err := a.DB.Query(ctx, `SELECT g.scope,g.classification_limit FROM sdl_access_grants g JOIN sdl_roles r ON r.role_key=g.role_key AND r.is_active JOIN sdl_user_units uu ON uu.user_id=g.user_id AND uu.unit_key=g.unit_key JOIN sdl_users u ON u.id=g.user_id AND u.is_active AND NOT u.must_change_password WHERE g.user_id::text=$1 AND g.unit_key=$2 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')`, who(ctx), unit)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var scope, limit string
		if err = rows.Scan(&scope, &limit); err != nil {
			return false, err
		}
		if classification == "penting" && limit != "penting" {
			continue
		}
		switch action {
		case "create":
			if scope == "own" || scope == "unit" {
				return true, nil
			}
		case "read":
			if scope == "unit" || scope == "own" && owner == who(ctx) {
				return true, nil
			}
			if (scope == "assigned" || scope == "own") && recordID != "" {
				var yes bool
				err = a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_unit_work_tasks WHERE record_id::text=$1 AND to_user::text=$2 AND status<>'cancelled')`, recordID, who(ctx)).Scan(&yes)
				if err != nil {
					return false, err
				}
				if yes {
					return true, nil
				}
			}
		case "edit", "delete", "assign":
			if scope == "unit" || scope == "own" && owner == who(ctx) {
				return true, nil
			}
		case "upload":
			if scope == "unit" || scope == "own" && owner == who(ctx) {
				return true, nil
			}
			if (scope == "assigned" || scope == "own") && recordID != "" {
				var yes bool
				err = a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_unit_work_tasks WHERE record_id::text=$1 AND to_user::text=$2 AND status IN ('pending','received'))`, recordID, who(ctx)).Scan(&yes)
				if err != nil {
					return false, err
				}
				if yes {
					return true, nil
				}
			}
		}
	}
	return false, rows.Err()
}

type Record struct {
	ID             string    `json:"id"`
	Unit           string    `json:"unit"`
	Category       string    `json:"category"`
	Title          string    `json:"title"`
	Description    string    `json:"description"`
	Classification string    `json:"classification"`
	Owner          string    `json:"owner"`
	Version        int64     `json:"version"`
	CreatedAt      time.Time `json:"createdAt"`
}

func scanRecord(row interface{ Scan(...any) error }) (Record, error) {
	var p Record
	err := row.Scan(&p.ID, &p.Unit, &p.Category, &p.Title, &p.Description, &p.Classification, &p.Owner, &p.Version, &p.CreatedAt)
	return p, err
}

const recColumns = `SELECT id::text,unit_key,category,title,description,classification,created_by::text,version,created_at FROM sdl_unit_work_records`

func (a *API) record(ctx context.Context, unit, id string) (Record, error) {
	return scanRecord(a.DB.QueryRow(ctx, recColumns+` WHERE id::text=$1 AND unit_key=$2 AND deleted_at IS NULL`, id, unit))
}
func (a *API) visible(w http.ResponseWriter, r *http.Request, unit, id, action string) (Record, bool) {
	p, err := a.record(r.Context(), unit, id)
	if err != nil {
		sqlerr(w, err)
		return p, false
	}
	yes, err := a.permit(r.Context(), unit, p.Classification, p.Owner, p.ID, action)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return p, false
	}
	if !yes {
		fail(w, 403, "access_denied")
		return p, false
	}
	return p, true
}
func (a *API) Routes(r chi.Router) {
	r.Get("/{unit}/people", a.people)
	r.Get("/{unit}/records", a.list)
	r.Post("/{unit}/records", a.create)
	r.Get("/{unit}/records/{id}", a.detail)
	r.Patch("/{unit}/records/{id}", a.update)
	r.Delete("/{unit}/records/{id}", a.remove)
	r.Post("/{unit}/records/{id}/files", a.upload)
	r.Get("/{unit}/records/{id}/files/{fileID}", a.download)
	r.Delete("/{unit}/records/{id}/files/{fileID}", a.deleteFile)
	r.Post("/{unit}/records/{id}/tasks", a.assign)
	r.Post("/{unit}/records/{id}/tasks/{taskID}/receive", a.taskAction("received"))
	r.Post("/{unit}/records/{id}/tasks/{taskID}/complete", a.taskAction("completed"))
	r.Post("/{unit}/records/{id}/tasks/{taskID}/cancel", a.taskAction("cancelled"))
}
func routeUnit(w http.ResponseWriter, r *http.Request) string {
	u := chi.URLParam(r, "unit")
	if !allowedUnit(u) {
		fail(w, 404, "unknown_unit")
		return ""
	}
	return u
}
func (a *API) people(w http.ResponseWriter, r *http.Request) {
	unit := routeUnit(w, r)
	if unit == "" {
		return
	}
	yes, err := a.permit(r.Context(), unit, "biasa", "", "", "create")
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !yes {
		fail(w, 403, "access_denied")
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT DISTINCT u.id::text,u.display_name FROM sdl_users u JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$1 JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=$1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now()) JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active WHERE u.is_active AND NOT u.must_change_password AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin') ORDER BY u.display_name LIMIT 100`, unit)
	if err != nil {
		fail(w, 503, "database_unavailable")
		return
	}
	defer rows.Close()
	items := []map[string]string{}
	for rows.Next() {
		var id, name string
		if err = rows.Scan(&id, &name); err != nil {
			break
		}
		if id != who(r.Context()) {
			items = append(items, map[string]string{"id": id, "name": name})
		}
	}
	if err == nil {
		err = rows.Err()
	}
	if err != nil {
		fail(w, 503, "database_unavailable")
		return
	}
	respond(w, 200, map[string]any{"items": items})
}
func (a *API) list(w http.ResponseWriter, r *http.Request) {
	unit := routeUnit(w, r)
	if unit == "" {
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(query) > 120 {
		fail(w, 400, "invalid_search")
		return
	}
	rows, err := a.DB.Query(r.Context(), recColumns+` WHERE unit_key=$1 AND deleted_at IS NULL AND ($2='' OR title ILIKE '%'||$2||'%' OR category ILIKE '%'||$2||'%') ORDER BY created_at DESC LIMIT 201`, unit, query)
	if err != nil {
		fail(w, 503, "database_unavailable")
		return
	}
	items := []Record{}
	for rows.Next() {
		p, e := scanRecord(rows)
		if e != nil {
			err = e
			break
		}
		yes, e := a.permit(r.Context(), unit, p.Classification, p.Owner, p.ID, "read")
		if e != nil {
			err = e
			break
		}
		if yes && len(items) < 200 {
			items = append(items, p)
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		fail(w, 503, "database_unavailable")
		return
	}
	respond(w, 200, map[string]any{"items": items, "limited": len(items) >= 200})
}

type recordInput struct {
	Category       string `json:"category"`
	Title          string `json:"title"`
	Description    string `json:"description"`
	Classification string `json:"classification"`
	Version        int64  `json:"version"`
}

func validInput(i recordInput) bool {
	return lenOK(i.Category, 2, 100) && lenOK(i.Title, 3, 240) && len([]rune(i.Description)) <= 4000 && (i.Classification == "biasa" || i.Classification == "penting")
}
func (a *API) create(w http.ResponseWriter, r *http.Request) {
	unit := routeUnit(w, r)
	if unit == "" {
		return
	}
	var v recordInput
	if !decode(w, r, &v) {
		return
	}
	if !validInput(v) {
		fail(w, 400, "invalid_record")
		return
	}
	yes, err := a.permit(r.Context(), unit, v.Classification, who(r.Context()), "", "create")
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !yes {
		fail(w, 403, "access_denied")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var id string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_unit_work_records(unit_key,category,title,description,classification,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6::uuid,$6::uuid) RETURNING id::text`, unit, strings.TrimSpace(v.Category), strings.TrimSpace(v.Title), strings.TrimSpace(v.Description), v.Classification, who(r.Context())).Scan(&id)
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'created','Register dibuat')`, id, who(r.Context()))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		sqlerr(w, err)
		return
	}
	respond(w, 201, map[string]string{"id": id})
}
func (a *API) update(w http.ResponseWriter, r *http.Request) {
	unit := routeUnit(w, r)
	if unit == "" {
		return
	}
	id := chi.URLParam(r, "id")
	p, ok := a.visible(w, r, unit, id, "edit")
	if !ok {
		return
	}
	var v recordInput
	if !decode(w, r, &v) {
		return
	}
	if !validInput(v) || v.Version < 1 {
		fail(w, 400, "invalid_record")
		return
	}
	yes, err := a.permit(r.Context(), unit, v.Classification, p.Owner, p.ID, "edit")
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !yes {
		fail(w, 403, "access_denied")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if unit == "urmin" {
		if err = lockOutgoingEditing(r.Context(), tx, id); err != nil {
			if errors.Is(err, errOutgoingLocked) {
				fail(w, 409, "outgoing_locked")
			} else {
				sqlerr(w, err)
			}
			return
		}
	}
	cmd, err := tx.Exec(r.Context(), `UPDATE sdl_unit_work_records SET category=$3,title=$4,description=$5,classification=$6,updated_by=$7::uuid,version=version+1,updated_at=now() WHERE id::text=$1 AND unit_key=$2 AND deleted_at IS NULL AND version=$8`, id, unit, strings.TrimSpace(v.Category), strings.TrimSpace(v.Title), strings.TrimSpace(v.Description), v.Classification, who(r.Context()), v.Version)
	if err == nil && cmd.RowsAffected() != 1 {
		fail(w, 409, "stale_version")
		return
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'updated','Register diperbarui')`, id, who(r.Context()))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		sqlerr(w, err)
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}
func (a *API) remove(w http.ResponseWriter, r *http.Request) {
	unit := routeUnit(w, r)
	if unit == "" {
		return
	}
	id := chi.URLParam(r, "id")
	_, ok := a.visible(w, r, unit, id, "delete")
	if !ok {
		return
	}
	var open int
	err := a.DB.QueryRow(r.Context(), `SELECT count(*) FROM sdl_unit_work_tasks WHERE record_id::text=$1 AND status IN ('pending','received')`, id).Scan(&open)
	if err != nil {
		sqlerr(w, err)
		return
	}
	if open > 0 {
		fail(w, 409, "active_disposition")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if unit == "urmin" {
		if err = lockOutgoingEditing(r.Context(), tx, id); err != nil {
			if errors.Is(err, errOutgoingLocked) {
				fail(w, 409, "outgoing_locked")
			} else {
				sqlerr(w, err)
			}
			return
		}
	}
	cmd, err := tx.Exec(r.Context(), `UPDATE sdl_unit_work_records SET deleted_at=now(),updated_by=$2::uuid,updated_at=now() WHERE id::text=$1 AND deleted_at IS NULL`, id, who(r.Context()))
	if err == nil && cmd.RowsAffected() != 1 {
		fail(w, 409, "already_removed")
		return
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'deleted','Arsip soft-delete')`, id, who(r.Context()))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		sqlerr(w, err)
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}

type FileInfo struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	MediaType string    `json:"mediaType"`
	Size      int       `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
	// R5H5 (migrasi 044). Hanya muncul untuk berkas pendukung; lampiran —
	// termasuk setiap berkas yang ada sebelum 044 — diserialisasi persis
	// seperti sebelumnya.
	Purpose string `json:"purpose,omitempty"`
}

// R5H5: nilai field multipart "purpose" pada unggah berkas. Kosong berarti
// lampiran, supaya pemanggil lama tidak berubah perilakunya.
func filePurpose(raw string) (string, bool) {
	switch raw {
	case "", "lampiran":
		return "lampiran", true
	case "pendukung":
		return "pendukung", true
	}
	return "", false
}

type Task struct {
	ID          string    `json:"id"`
	From        string    `json:"from"`
	To          string    `json:"to"`
	ToName      string    `json:"toName"`
	Instruction string    `json:"instruction"`
	DueDate     *string   `json:"dueDate"`
	Status      string    `json:"status"`
	Response    string    `json:"response"`
	CreatedAt   time.Time `json:"createdAt"`
}

func (a *API) detail(w http.ResponseWriter, r *http.Request) {
	unit := routeUnit(w, r)
	if unit == "" {
		return
	}
	id := chi.URLParam(r, "id")
	p, ok := a.visible(w, r, unit, id, "read")
	if !ok {
		return
	}
	files := []FileInfo{}
	tasks := []Task{}
	events := []map[string]string{}
	rows, err := a.DB.Query(r.Context(), `SELECT id::text,file_name,media_type,byte_size,created_at,CASE WHEN purpose='pendukung' THEN 'pendukung' ELSE '' END FROM sdl_unit_work_files WHERE record_id::text=$1 AND removed_at IS NULL ORDER BY created_at DESC`, id)
	if err != nil {
		sqlerr(w, err)
		return
	}
	for rows.Next() {
		var f FileInfo
		if err = rows.Scan(&f.ID, &f.Name, &f.MediaType, &f.Size, &f.CreatedAt, &f.Purpose); err != nil {
			break
		}
		files = append(files, f)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		sqlerr(w, err)
		return
	}
	rows, err = a.DB.Query(r.Context(), `SELECT t.id::text,t.from_user::text,t.to_user::text,u.display_name,t.instruction,t.due_date::text,t.status,t.response,t.created_at FROM sdl_unit_work_tasks t JOIN sdl_users u ON u.id=t.to_user WHERE t.record_id::text=$1 ORDER BY t.created_at DESC LIMIT 100`, id)
	if err != nil {
		sqlerr(w, err)
		return
	}
	for rows.Next() {
		var t Task
		if err = rows.Scan(&t.ID, &t.From, &t.To, &t.ToName, &t.Instruction, &t.DueDate, &t.Status, &t.Response, &t.CreatedAt); err != nil {
			break
		}
		tasks = append(tasks, t)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		sqlerr(w, err)
		return
	}
	rows, err = a.DB.Query(r.Context(), `SELECT e.action,e.note,u.display_name,to_char(e.created_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD HH24:MI') FROM sdl_unit_work_events e JOIN sdl_users u ON u.id=e.actor_id WHERE e.record_id::text=$1 ORDER BY e.id DESC LIMIT 80`, id)
	if err != nil {
		sqlerr(w, err)
		return
	}
	for rows.Next() {
		var action, note, user, at string
		if err = rows.Scan(&action, &note, &user, &at); err != nil {
			break
		}
		events = append(events, map[string]string{"action": action, "note": note, "user": user, "at": at})
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		sqlerr(w, err)
		return
	}
	respond(w, 200, map[string]any{"record": p, "files": files, "tasks": tasks, "events": events})
}
func safeName(raw string) string {
	raw = strings.ReplaceAll(raw, "\\", "/")
	name := path.Base(raw)
	name = strings.TrimSpace(name)
	if len(name) > 180 {
		name = name[:180]
	}
	if name == "" || name == "." || name == "/" {
		return "file"
	}
	return name
}
func fileType(b []byte) string {
	if len(b) >= 4 && bytes.Equal(b[:4], []byte("%PDF")) {
		return "application/pdf"
	}
	if len(b) >= 3 && bytes.Equal(b[:3], []byte{0xff, 0xd8, 0xff}) {
		return "image/jpeg"
	}
	if len(b) >= 8 && bytes.Equal(b[:8], []byte{137, 80, 78, 71, 13, 10, 26, 10}) {
		return "image/png"
	}
	return ""
}
func (a *API) upload(w http.ResponseWriter, r *http.Request) {
	unit := routeUnit(w, r)
	if unit == "" {
		return
	}
	id := chi.URLParam(r, "id")
	_, ok := a.visible(w, r, unit, id, "upload")
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 6<<20)
	f, h, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, "file_required_or_too_large")
		return
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, (5<<20)+1))
	if err != nil || len(b) == 0 || len(b) > (5<<20) {
		fail(w, 400, "file_limit_5mib")
		return
	}
	media := fileType(b)
	if media == "" {
		fail(w, 400, "unsupported_file_type")
		return
	}
	purpose, valid := filePurpose(r.FormValue("purpose"))
	if !valid {
		fail(w, 400, "invalid_purpose")
		return
	}
	var count int
	// Batas 10 dihitung per jenis: berkas pendukung tidak boleh menghabiskan
	// jatah lampiran surat, dan sebaliknya.
	err = a.DB.QueryRow(r.Context(), `SELECT count(*) FROM sdl_unit_work_files WHERE record_id::text=$1 AND removed_at IS NULL AND purpose=$2`, id, purpose).Scan(&count)
	if err != nil {
		sqlerr(w, err)
		return
	}
	if count >= 10 {
		fail(w, 409, "max_10_files")
		return
	}
	digest := sha256.Sum256(b)
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	// Berkas pendukung tidak dikunci alur surat keluar: ia tidak ikut sidik
	// jari persetujuan, jadi menambahkannya tidak mengubah dokumen yang ditinjau.
	if unit == "urmin" && purpose == "lampiran" {
		if err = lockOutgoingEditing(r.Context(), tx, id); err != nil {
			if errors.Is(err, errOutgoingLocked) {
				fail(w, 409, "outgoing_locked")
			} else {
				sqlerr(w, err)
			}
			return
		}
	}
	var fileID string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_unit_work_files(record_id,file_name,media_type,byte_size,sha256,file_data,uploaded_by,purpose) VALUES($1::uuid,$2,$3,$4,$5,$6,$7::uuid,$8) RETURNING id::text`, id, safeName(h.Filename), media, len(b), hex.EncodeToString(digest[:]), b, who(r.Context()), purpose).Scan(&fileID)
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'uploaded',$3)`, id, who(r.Context()), safeName(h.Filename))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		sqlerr(w, err)
		return
	}
	respond(w, 201, map[string]string{"id": fileID})
}
func (a *API) download(w http.ResponseWriter, r *http.Request) {
	unit := routeUnit(w, r)
	if unit == "" {
		return
	}
	id := chi.URLParam(r, "id")
	_, ok := a.visible(w, r, unit, id, "read")
	if !ok {
		return
	}
	var name, media, expected string
	var b []byte
	err := a.DB.QueryRow(r.Context(), `SELECT file_name,media_type,sha256,file_data FROM sdl_unit_work_files WHERE id::text=$1 AND record_id::text=$2 AND removed_at IS NULL`, chi.URLParam(r, "fileID"), id).Scan(&name, &media, &expected, &b)
	if err != nil {
		sqlerr(w, err)
		return
	}
	digest := sha256.Sum256(b)
	if hex.EncodeToString(digest[:]) != expected {
		fail(w, 503, "integrity_mismatch")
		return
	}
	if media == "application/pdf" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	} else {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": name}))
	}
	w.Header().Set("Content-Type", media)
	w.Header().Set("Content-Length", stringInt(len(b)))
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(200)
	_, _ = w.Write(b)
}
func stringInt(i int) string { // Avoid fmt allocations on large download paths.
	if i == 0 {
		return "0"
	}
	b := make([]byte, 0, 12)
	for i > 0 {
		b = append(b, byte('0'+i%10))
		i /= 10
	}
	for k := 0; k < len(b)/2; k++ {
		b[k], b[len(b)-1-k] = b[len(b)-1-k], b[k]
	}
	return string(b)
}
func (a *API) deleteFile(w http.ResponseWriter, r *http.Request) {
	unit := routeUnit(w, r)
	if unit == "" {
		return
	}
	id := chi.URLParam(r, "id")
	_, ok := a.visible(w, r, unit, id, "edit")
	if !ok {
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	// R5H5: berkas pendukung boleh dihapus kapan saja, sama seperti boleh
	// ditambah kapan saja. Berkas yang tidak ditemukan diperlakukan sebagai
	// lampiran, sehingga urutan pemeriksaannya tidak berubah: kunci dulu,
	// baru 404.
	var purpose string
	err = tx.QueryRow(r.Context(), `SELECT purpose FROM sdl_unit_work_files WHERE id::text=$1 AND record_id::text=$2 AND removed_at IS NULL`, chi.URLParam(r, "fileID"), id).Scan(&purpose)
	if errors.Is(err, pgx.ErrNoRows) {
		purpose, err = "lampiran", nil
	}
	if err != nil {
		sqlerr(w, err)
		return
	}
	if unit == "urmin" && purpose == "lampiran" {
		if err = lockOutgoingEditing(r.Context(), tx, id); err != nil {
			if errors.Is(err, errOutgoingLocked) {
				fail(w, 409, "outgoing_locked")
			} else {
				sqlerr(w, err)
			}
			return
		}
	}
	cmd, err := tx.Exec(r.Context(), `UPDATE sdl_unit_work_files SET removed_at=now() WHERE id::text=$1 AND record_id::text=$2 AND removed_at IS NULL`, chi.URLParam(r, "fileID"), id)
	if err == nil && cmd.RowsAffected() != 1 {
		fail(w, 404, "not_found")
		return
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'file_removed','Lampiran dihapus dari tampilan')`, id, who(r.Context()))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		sqlerr(w, err)
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}

type assignment struct {
	To          string `json:"to"`
	Instruction string `json:"instruction"`
	DueDate     string `json:"dueDate"`
}

func (a *API) assign(w http.ResponseWriter, r *http.Request) {
	unit := routeUnit(w, r)
	if unit == "" {
		return
	}
	id := chi.URLParam(r, "id")
	p, ok := a.visible(w, r, unit, id, "assign")
	if !ok {
		return
	}
	var v assignment
	if !decode(w, r, &v) {
		return
	}
	if !lenOK(v.Instruction, 5, 1000) || v.To == who(r.Context()) {
		fail(w, 400, "invalid_assignment")
		return
	}
	var due any
	if v.DueDate != "" {
		d, err := time.Parse("2006-01-02", v.DueDate)
		if err != nil {
			fail(w, 400, "invalid_date")
			return
		}
		due = d
	}
	var eligible bool
	err := a.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_users u JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$2 JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=$2 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now()) JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active WHERE u.id::text=$1 AND u.is_active AND NOT u.must_change_password AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin') AND (g.classification_limit='penting' OR $3='biasa'))`, v.To, unit, p.Classification).Scan(&eligible)
	if err != nil {
		sqlerr(w, err)
		return
	}
	if !eligible {
		fail(w, 403, "recipient_not_allowed")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var taskID string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_unit_work_tasks(record_id,from_user,to_user,instruction,due_date) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5) RETURNING id::text`, id, who(r.Context()), v.To, strings.TrimSpace(v.Instruction), due).Scan(&taskID)
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,task_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,$3::uuid,'assigned',$4)`, id, taskID, who(r.Context()), strings.TrimSpace(v.Instruction))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		sqlerr(w, err)
		return
	}
	respond(w, 201, map[string]string{"id": taskID})
}

type taskInput struct {
	Response string `json:"response"`
}

func (a *API) taskAction(next string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		unit := routeUnit(w, r)
		if unit == "" {
			return
		}
		id := chi.URLParam(r, "id")
		_, ok := a.visible(w, r, unit, id, "read")
		if !ok {
			return
		}
		var input taskInput
		if !decode(w, r, &input) {
			return
		}
		if len([]rune(input.Response)) > 1000 {
			fail(w, 400, "invalid_response")
			return
		}
		if next == "completed" && !lenOK(input.Response, 3, 1000) {
			fail(w, 400, "response_required")
			return
		}
		tx, err := a.DB.Begin(r.Context())
		if err != nil {
			sqlerr(w, err)
			return
		}
		defer tx.Rollback(r.Context())
		var status, from, to string
		err = tx.QueryRow(r.Context(), `SELECT status,from_user::text,to_user::text FROM sdl_unit_work_tasks WHERE id::text=$1 AND record_id::text=$2 FOR UPDATE`, chi.URLParam(r, "taskID"), id).Scan(&status, &from, &to)
		if err != nil {
			sqlerr(w, err)
			return
		}
		// Demo-only operational preview: Superadmin may step through an assigned
		// R5A task without switching login; events still record the real admin.
		demo, demoErr := devdemo.Superadmin(r.Context(), a.DB, who(r.Context()))
		if demoErr != nil {
			fail(w, 503, "authorization_unavailable")
			return
		}
		if demo {
			fail(w, 403, "access_denied") // R5F20B: no Superadmin task mutation in demo
			return
		}
		allow := (next == "received" && status == "pending" && who(r.Context()) == to) || (next == "completed" && status == "received" && who(r.Context()) == to) || (next == "cancelled" && (status == "pending" || status == "received") && who(r.Context()) == from)
		// R5F20B: transition requires task ownership; no demo elevation.
		if !allow {
			fail(w, 409, "invalid_task_transition")
			return
		}
		_, err = tx.Exec(r.Context(), `UPDATE sdl_unit_work_tasks SET status=$2,response=$3,updated_at=now() WHERE id::text=$1`, chi.URLParam(r, "taskID"), next, strings.TrimSpace(input.Response))
		if err == nil {
			note := strings.TrimSpace(input.Response)
			// R5F20B: actor is always the authorized operational user.
			_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,task_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5)`, id, chi.URLParam(r, "taskID"), who(r.Context()), next, note)
		}
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			sqlerr(w, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	}
}
