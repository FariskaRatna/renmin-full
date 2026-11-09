package unitwork

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// R5C keeps the business fields separate from the R5A file and disposition ledger.
// No new role/permission is granted. Unit access follows active R5A grants.
var binfungFields = map[string][]string{
	"sop":       {"jenis", "versi", "pemilikProses", "tanggalBerlaku", "statusDokumen", "keterangan"},
	"pid":       {"kategori", "tingkatAkses", "tanggalDokumen", "sumber", "statusDokumen", "keterangan"},
	"rb":        {"areaPerubahan", "periode", "target", "capaian", "pic", "statusTindakLanjut"},
	"abk":       {"unit", "periode", "volume", "kebutuhan", "pelaksana", "catatan"},
	"pembinaan": {"jenisKegiatan", "tanggal", "lokasi", "penanggungJawab", "peserta", "hasil"},
	"evaluasi":  {"jenis", "tanggal", "tenggat", "pic", "hasil", "tindakLanjut"},
}

type binfungInput struct {
	Kind           string            `json:"kind"`
	Code           string            `json:"code"`
	Title          string            `json:"title"`
	Classification string            `json:"classification"`
	Fields         map[string]string `json:"fields"`
	Version        int64             `json:"version"`
}
type binfungRow struct {
	ID             string            `json:"id"`
	Kind           string            `json:"kind"`
	Code           string            `json:"code"`
	Title          string            `json:"title"`
	Classification string            `json:"classification"`
	Fields         map[string]string `json:"fields"`
	WorkRecordID   string            `json:"workRecordId"`
	Owner          string            `json:"owner"`
	Version        int64             `json:"version"`
	CreatedAt      time.Time         `json:"createdAt"`
}

func binfungValid(v binfungInput) bool {
	allowed, exists := binfungFields[v.Kind]
	if !exists || !lenOK(v.Code, 2, 64) || !lenOK(v.Title, 3, 200) || (v.Classification != "biasa" && v.Classification != "penting") {
		return false
	}
	if v.Fields == nil || len(v.Fields) > len(allowed) {
		return false
	}
	for k, value := range v.Fields {
		ok := false
		for _, s := range allowed {
			if s == k {
				ok = true
				break
			}
		}
		if !ok || len([]rune(strings.TrimSpace(value))) > 200 {
			return false
		}
		if (k == "tanggalBerlaku" || k == "tanggalDokumen" || k == "tanggal" || k == "tenggat") && value != "" {
			if _, err := time.Parse("2006-01-02", value); err != nil {
				return false
			}
		}
		if (k == "volume" || k == "kebutuhan") && value != "" {
			if len(value) > 8 || value[0] < '0' || value[0] > '9' {
				return false
			}
			for _, c := range value {
				if c < '0' || c > '9' {
					return false
				}
			}
		}
	}
	return true
}
func (a *API) BinfungRoutes(r chi.Router) {
	r.Get("/", a.binfungList)
	r.Post("/", a.binfungCreate)
	r.Get("/{id}", a.binfungDetail)
	r.Patch("/{id}", a.binfungUpdate)
	r.Delete("/{id}", a.binfungDelete)
}

const binfungSelect = `SELECT s.id::text,s.kind,s.ref_code,s.title,w.classification,s.fields,s.work_record_id::text,w.created_by::text,s.version,s.created_at FROM sdl_binfung_registry s JOIN sdl_unit_work_records w ON w.id=s.work_record_id`

func scanBinfung(row interface{ Scan(...any) error }) (binfungRow, error) {
	var p binfungRow
	var body []byte
	err := row.Scan(&p.ID, &p.Kind, &p.Code, &p.Title, &p.Classification, &body, &p.WorkRecordID, &p.Owner, &p.Version, &p.CreatedAt)
	if err == nil {
		err = json.Unmarshal(body, &p.Fields)
	}
	return p, err
}
func (a *API) binfungOwned(ctx context.Context, id, action string) (binfungRow, error) {
	p, err := scanBinfung(a.DB.QueryRow(ctx, binfungSelect+` WHERE s.id::text=$1 AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.unit_key='subbagbinfung'`, id))
	if err != nil {
		return p, err
	}
	ok, err := a.permit(ctx, "subbagbinfung", p.Classification, p.Owner, p.WorkRecordID, action)
	if err != nil {
		return p, err
	}
	if !ok {
		return p, errBinfungDenied
	}
	return p, nil
}

var errBinfungDenied = errors.New("binfung_access_denied")

func binfungError(w http.ResponseWriter, err error) {
	if errors.Is(err, errBinfungDenied) {
		fail(w, 403, "access_denied")
		return
	}
	sqlerr(w, err)
}
func (a *API) binfungList(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	if _, ok := binfungFields[kind]; !ok {
		fail(w, 400, "invalid_kind")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) > 100 {
		fail(w, 400, "invalid_search")
		return
	}
	rows, err := a.DB.Query(r.Context(), binfungSelect+` WHERE s.kind=$1 AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.unit_key='subbagbinfung' AND ($2='' OR s.title ILIKE '%'||$2||'%' OR s.ref_code ILIKE '%'||$2||'%') ORDER BY s.created_at DESC,s.id DESC LIMIT 251`, kind, q)
	if err != nil {
		sqlerr(w, err)
		return
	}
	items := []binfungRow{}
	truncated := false
	for rows.Next() {
		p, e := scanBinfung(rows)
		if e != nil {
			err = e
			break
		}
		allowed, e := a.permit(r.Context(), "subbagbinfung", p.Classification, p.Owner, p.WorkRecordID, "read")
		if e != nil {
			err = e
			break
		}
		if allowed {
			if len(items) < 100 {
				items = append(items, p)
			} else {
				truncated = true
			}
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		sqlerr(w, err)
		return
	}
	respond(w, 200, map[string]any{"items": items, "limited": truncated})
}
func (a *API) binfungDetail(w http.ResponseWriter, r *http.Request) {
	p, err := a.binfungOwned(r.Context(), chi.URLParam(r, "id"), "read")
	if err != nil {
		binfungError(w, err)
		return
	}
	respond(w, 200, p)
}
func (a *API) binfungCreate(w http.ResponseWriter, r *http.Request) {
	var v binfungInput
	if !decode(w, r, &v) {
		return
	}
	if !binfungValid(v) {
		fail(w, 400, "invalid_binfung_record")
		return
	}
	ok, err := a.permit(r.Context(), "subbagbinfung", v.Classification, who(r.Context()), "", "create")
	if err != nil {
		sqlerr(w, err)
		return
	}
	if !ok {
		fail(w, 403, "access_denied")
		return
	}
	body, _ := json.Marshal(v.Fields)
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var workID, id string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_unit_work_records(unit_key,category,title,description,classification,created_by,updated_by) VALUES('subbagbinfung',$1,$2,'',$3,$4::uuid,$4::uuid) RETURNING id::text`, "Master "+v.Kind, strings.TrimSpace(v.Title), v.Classification, who(r.Context())).Scan(&workID)
	if err == nil {
		err = tx.QueryRow(r.Context(), `INSERT INTO sdl_binfung_registry(kind,ref_code,title,fields,work_record_id,created_by,updated_by) VALUES($1,$2,$3,$4::jsonb,$5::uuid,$6::uuid,$6::uuid) RETURNING id::text`, v.Kind, strings.TrimSpace(v.Code), strings.TrimSpace(v.Title), string(body), workID, who(r.Context())).Scan(&id)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'created',$3)`, workID, who(r.Context()), "Master Subbagbinfung: "+v.Kind)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		binfungWriteError(w, err)
		return
	}
	respond(w, 201, map[string]string{"id": id, "workRecordId": workID})
}
func binfungWriteError(w http.ResponseWriter, err error) {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		fail(w, 409, "duplicate_code")
		return
	}
	sqlerr(w, err)
}
func (a *API) binfungUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := a.binfungOwned(r.Context(), id, "edit")
	if err != nil {
		binfungError(w, err)
		return
	}
	var v binfungInput
	if !decode(w, r, &v) {
		return
	}
	if !binfungValid(v) || v.Kind != p.Kind || v.Version < 1 {
		fail(w, 400, "invalid_binfung_record")
		return
	}
	ok, err := a.permit(r.Context(), "subbagbinfung", v.Classification, p.Owner, p.WorkRecordID, "edit")
	if err != nil {
		sqlerr(w, err)
		return
	}
	if !ok {
		fail(w, 403, "access_denied")
		return
	}
	body, _ := json.Marshal(v.Fields)
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	cmd, err := tx.Exec(r.Context(), `UPDATE sdl_binfung_registry SET ref_code=$3,title=$4,fields=$5::jsonb,version=version+1,updated_by=$6::uuid,updated_at=now() WHERE id::text=$1 AND kind=$2 AND deleted_at IS NULL AND version=$7`, id, v.Kind, strings.TrimSpace(v.Code), strings.TrimSpace(v.Title), string(body), who(r.Context()), v.Version)
	if err == nil && cmd.RowsAffected() != 1 {
		fail(w, 409, "stale_version")
		return
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE sdl_unit_work_records SET title=$2,classification=$3,updated_by=$4::uuid,version=version+1,updated_at=now() WHERE id::text=$1 AND deleted_at IS NULL`, p.WorkRecordID, strings.TrimSpace(v.Title), v.Classification, who(r.Context()))
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'updated','Master Subbagbinfung diperbarui')`, p.WorkRecordID, who(r.Context()))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		binfungWriteError(w, err)
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}
func (a *API) binfungDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := a.binfungOwned(r.Context(), id, "delete")
	if err != nil {
		binfungError(w, err)
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	// Serialize against task create/transition using the parent work-record row lock.
	var locked string
	err = tx.QueryRow(r.Context(), `SELECT id::text FROM sdl_unit_work_records WHERE id::text=$1 AND deleted_at IS NULL FOR UPDATE`, p.WorkRecordID).Scan(&locked)
	if err != nil {
		sqlerr(w, err)
		return
	}
	var active bool
	err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_unit_work_tasks WHERE record_id::text=$1 AND status IN ('pending','received'))`, locked).Scan(&active)
	if err != nil {
		sqlerr(w, err)
		return
	}
	if active {
		fail(w, 409, "active_disposition")
		return
	}
	cmd, err := tx.Exec(r.Context(), `UPDATE sdl_binfung_registry SET deleted_at=now(),updated_by=$2::uuid,updated_at=now() WHERE id::text=$1 AND deleted_at IS NULL`, id, who(r.Context()))
	if err == nil && cmd.RowsAffected() != 1 {
		fail(w, 409, "already_removed")
		return
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE sdl_unit_work_records SET deleted_at=now(),updated_by=$2::uuid,updated_at=now() WHERE id::text=$1`, p.WorkRecordID, who(r.Context()))
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'deleted','Master Subbagbinfung diarsipkan')`, p.WorkRecordID, who(r.Context()))
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
