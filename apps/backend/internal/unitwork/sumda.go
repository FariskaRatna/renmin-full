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

// R5B keeps the business fields separate from the R5A file and disposition ledger.
// No new role/permission is granted. Unit access follows active R5A grants.
var sumdaFields = map[string][]string{
	"personel":   {"pangkat", "jabatan", "status", "unitKerja", "keterangan"},
	"pendidikan": {"jenis", "penyelenggara", "tanggalMulai", "tanggalSelesai", "peserta", "hasil"},
	"inventaris": {"kategori", "kondisi", "lokasi", "jumlah", "penanggungJawab", "keterangan"},
}

type sumdaInput struct {
	Kind           string            `json:"kind"`
	Code           string            `json:"code"`
	Title          string            `json:"title"`
	Classification string            `json:"classification"`
	Fields         map[string]string `json:"fields"`
	Version        int64             `json:"version"`
}
type sumdaRow struct {
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

func sumdaValid(v sumdaInput) bool {
	allowed, exists := sumdaFields[v.Kind]
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
		if (k == "tanggalMulai" || k == "tanggalSelesai") && value != "" {
			if _, err := time.Parse("2006-01-02", value); err != nil {
				return false
			}
		}
		if k == "jumlah" && value != "" {
			if len(value) > 8 || value[0] < '1' || value[0] > '9' {
				return false
			}
			for _, c := range value {
				if c < '0' || c > '9' {
					return false
				}
			}
		}
	}
	if v.Kind == "pendidikan" && v.Fields["tanggalMulai"] != "" && v.Fields["tanggalSelesai"] != "" && v.Fields["tanggalSelesai"] < v.Fields["tanggalMulai"] {
		return false
	}
	return true
}
func (a *API) SumdaRoutes(r chi.Router) {
	r.Get("/ranks", a.sumdaRanks)
	r.Get("/", a.sumdaList)
	r.Post("/", a.sumdaCreate)
	r.Get("/{id}", a.sumdaDetail)
	r.Patch("/{id}", a.sumdaUpdate)
	r.Delete("/{id}", a.sumdaDelete)
}

// Polri ranks are served from PostgreSQL, never hardcoded in the frontend.
func (a *API) sumdaRanks(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `SELECT code,short_name,full_name,rank_group FROM sdl_polri_rank_master WHERE is_active=TRUE ORDER BY sort_order`)
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]string{}
	for rows.Next() {
		var code, short, full, group string
		if err = rows.Scan(&code, &short, &full, &group); err != nil {
			sqlerr(w, err)
			return
		}
		items = append(items, map[string]string{"code": code, "shortName": short, "fullName": full, "group": group})
	}
	if err = rows.Err(); err != nil {
		sqlerr(w, err)
		return
	}
	respond(w, 200, map[string]any{"items": items})
}

func (a *API) validRank(ctx context.Context, v sumdaInput) (bool, error) {
	if v.Kind != "personel" || strings.TrimSpace(v.Fields["pangkat"]) == "" {
		return true, nil
	}
	var valid bool
	err := a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_polri_rank_master WHERE code=$1 AND is_active=TRUE)`, v.Fields["pangkat"]).Scan(&valid)
	return valid, err
}

const sumdaSelect = `SELECT s.id::text,s.kind,s.ref_code,s.title,w.classification,s.fields,s.work_record_id::text,w.created_by::text,s.version,s.created_at FROM sdl_sumda_registry s JOIN sdl_unit_work_records w ON w.id=s.work_record_id`

func scanSumda(row interface{ Scan(...any) error }) (sumdaRow, error) {
	var p sumdaRow
	var body []byte
	err := row.Scan(&p.ID, &p.Kind, &p.Code, &p.Title, &p.Classification, &body, &p.WorkRecordID, &p.Owner, &p.Version, &p.CreatedAt)
	if err == nil {
		err = json.Unmarshal(body, &p.Fields)
	}
	return p, err
}
func (a *API) sumdaOwned(ctx context.Context, id, action string) (sumdaRow, error) {
	p, err := scanSumda(a.DB.QueryRow(ctx, sumdaSelect+` WHERE s.id::text=$1 AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.unit_key='subbagsumda'`, id))
	if err != nil {
		return p, err
	}
	ok, err := a.permit(ctx, "subbagsumda", p.Classification, p.Owner, p.WorkRecordID, action)
	if err != nil {
		return p, err
	}
	if !ok {
		return p, errSumdaDenied
	}
	return p, nil
}

var errSumdaDenied = errors.New("sumda_access_denied")

func sumdaError(w http.ResponseWriter, err error) {
	if errors.Is(err, errSumdaDenied) {
		fail(w, 403, "access_denied")
		return
	}
	sqlerr(w, err)
}
func (a *API) sumdaList(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	if _, ok := sumdaFields[kind]; !ok {
		fail(w, 400, "invalid_kind")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) > 100 {
		fail(w, 400, "invalid_search")
		return
	}
	rows, err := a.DB.Query(r.Context(), sumdaSelect+` WHERE s.kind=$1 AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.unit_key='subbagsumda' AND ($2='' OR s.title ILIKE '%'||$2||'%' OR s.ref_code ILIKE '%'||$2||'%') ORDER BY s.created_at DESC,s.id DESC LIMIT 251`, kind, q)
	if err != nil {
		sqlerr(w, err)
		return
	}
	items := []sumdaRow{}
	truncated := false
	for rows.Next() {
		p, e := scanSumda(rows)
		if e != nil {
			err = e
			break
		}
		allowed, e := a.permit(r.Context(), "subbagsumda", p.Classification, p.Owner, p.WorkRecordID, "read")
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
func (a *API) sumdaDetail(w http.ResponseWriter, r *http.Request) {
	p, err := a.sumdaOwned(r.Context(), chi.URLParam(r, "id"), "read")
	if err != nil {
		sumdaError(w, err)
		return
	}
	respond(w, 200, p)
}
func (a *API) sumdaCreate(w http.ResponseWriter, r *http.Request) {
	var v sumdaInput
	if !decode(w, r, &v) {
		return
	}
	if !sumdaValid(v) {
		fail(w, 400, "invalid_sumda_record")
		return
	}
	rankValid, err := a.validRank(r.Context(), v)
	if err != nil {
		sqlerr(w, err)
		return
	}
	if !rankValid {
		fail(w, 400, "invalid_polri_rank")
		return
	}
	ok, err := a.permit(r.Context(), "subbagsumda", v.Classification, who(r.Context()), "", "create")
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
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_unit_work_records(unit_key,category,title,description,classification,created_by,updated_by) VALUES('subbagsumda',$1,$2,'',$3,$4::uuid,$4::uuid) RETURNING id::text`, "Master "+v.Kind, strings.TrimSpace(v.Title), v.Classification, who(r.Context())).Scan(&workID)
	if err == nil {
		err = tx.QueryRow(r.Context(), `INSERT INTO sdl_sumda_registry(kind,ref_code,title,fields,work_record_id,created_by,updated_by) VALUES($1,$2,$3,$4::jsonb,$5::uuid,$6::uuid,$6::uuid) RETURNING id::text`, v.Kind, strings.TrimSpace(v.Code), strings.TrimSpace(v.Title), string(body), workID, who(r.Context())).Scan(&id)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'created',$3)`, workID, who(r.Context()), "Master Subbagsumda: "+v.Kind)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		sumdaWriteError(w, err)
		return
	}
	respond(w, 201, map[string]string{"id": id, "workRecordId": workID})
}
func sumdaWriteError(w http.ResponseWriter, err error) {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		fail(w, 409, "duplicate_code")
		return
	}
	sqlerr(w, err)
}
func (a *API) sumdaUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := a.sumdaOwned(r.Context(), id, "edit")
	if err != nil {
		sumdaError(w, err)
		return
	}
	var v sumdaInput
	if !decode(w, r, &v) {
		return
	}
	if !sumdaValid(v) || v.Kind != p.Kind || v.Version < 1 {
		fail(w, 400, "invalid_sumda_record")
		return
	}
	rankValid, err := a.validRank(r.Context(), v)
	if err != nil {
		sqlerr(w, err)
		return
	}
	if !rankValid {
		fail(w, 400, "invalid_polri_rank")
		return
	}
	ok, err := a.permit(r.Context(), "subbagsumda", v.Classification, p.Owner, p.WorkRecordID, "edit")
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
	cmd, err := tx.Exec(r.Context(), `UPDATE sdl_sumda_registry SET ref_code=$3,title=$4,fields=$5::jsonb,version=version+1,updated_by=$6::uuid,updated_at=now() WHERE id::text=$1 AND kind=$2 AND deleted_at IS NULL AND version=$7`, id, v.Kind, strings.TrimSpace(v.Code), strings.TrimSpace(v.Title), string(body), who(r.Context()), v.Version)
	if err == nil && cmd.RowsAffected() != 1 {
		fail(w, 409, "stale_version")
		return
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE sdl_unit_work_records SET title=$2,classification=$3,updated_by=$4::uuid,version=version+1,updated_at=now() WHERE id::text=$1 AND deleted_at IS NULL`, p.WorkRecordID, strings.TrimSpace(v.Title), v.Classification, who(r.Context()))
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'updated','Master Subbagsumda diperbarui')`, p.WorkRecordID, who(r.Context()))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		sumdaWriteError(w, err)
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}
func (a *API) sumdaDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := a.sumdaOwned(r.Context(), id, "delete")
	if err != nil {
		sumdaError(w, err)
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
	cmd, err := tx.Exec(r.Context(), `UPDATE sdl_sumda_registry SET deleted_at=now(),updated_by=$2::uuid,updated_at=now() WHERE id::text=$1 AND deleted_at IS NULL`, id, who(r.Context()))
	if err == nil && cmd.RowsAffected() != 1 {
		fail(w, 409, "already_removed")
		return
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE sdl_unit_work_records SET deleted_at=now(),updated_by=$2::uuid,updated_at=now() WHERE id::text=$1`, p.WorkRecordID, who(r.Context()))
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'deleted','Master Subbagsumda diarsipkan')`, p.WorkRecordID, who(r.Context()))
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
