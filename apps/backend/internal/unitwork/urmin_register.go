package unitwork

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// R5D keeps the business fields separate from the R5A file and disposition ledger.
// No new role/permission is granted. Unit access follows active R5A grants.
var urminregisterFields = map[string][]string{
	// R5G9 menambah "jenisSurat". "keterangan" berhenti ditampilkan di UI tapi
	// TETAP di daftar ini — daftar ini allowlist, dan mencabutnya akan membuat
	// setiap surat keluar LAMA gagal disunting dengan 400 karena form
	// mengirim balik kunci yang sudah tersimpan di JSONB-nya.
	//
	// R5H3 menambah delapan kunci isian dropdown (rujukan surat/arahan, jalur,
	// penandatangan, pemberi nomor, verifikator tambahan, tembusan, tipe
	// surat). Semuanya teks <=200 karakter seperti kunci lain; daftar
	// pilihannya hidup di layar sampai master datanya ditetapkan.
	"surat_keluar": {"nomorSurat", "tujuan", "tanggalSurat", "perihal", "sifatSurat", "statusAdministrasi", "keterangan", "jenisSurat", "kodeArsip", "unitNomor", "rujukanSurat", "rujukanArahan", "jalurSurat", "penandatangan", "pemberiNomor", "verifikator", "tembusan", "tipeSurat", "rujukanArahanId"},
	// R5G4 menambah "pimpinan" dan BERHENTI menampilkan jenisAgenda, hasil, dan
	// statusAgenda di UI. Ketiganya sengaja TETAP di daftar ini: daftar ini
	// adalah allowlist, dan `urminregisterValid` menolak payload yang memuat
	// kunci di luarnya. Mencabutnya akan membuat setiap agenda LAMA gagal
	// disunting dengan 400, karena form mengirim balik kunci yang sudah
	// tersimpan di JSONB-nya.
	"agenda": {"jenisAgenda", "tanggal", "waktu", "lokasi", "penyelenggara", "peserta", "hasil", "statusAgenda", "pimpinan", "yangMenghadiri"},
	"arsip":        {"jenisArsip", "tanggalDokumen", "lokasiSimpan", "retensi", "penanggungJawab", "statusArsip", "keterangan"},
}

type urminregisterInput struct {
	Kind           string            `json:"kind"`
	Code           string            `json:"code"`
	Title          string            `json:"title"`
	Classification string            `json:"classification"`
	Fields         map[string]string `json:"fields"`
	Version        int64             `json:"version"`
}
type urminregisterRow struct {
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
	WorkflowStatus string            `json:"workflowStatus"`
}

func urminregisterValid(v urminregisterInput) bool {
	allowed, exists := urminregisterFields[v.Kind]
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
		if (k == "tanggalSurat" || k == "tanggal" || k == "tanggalDokumen") && value != "" {
			if _, err := time.Parse("2006-01-02", value); err != nil {
				return false
			}
		}
		if k == "waktu" && value != "" {
			if _, err := time.Parse("15:04", value); err != nil {
				return false
			}
		}
		// R5H5: ID arahan yang dirujuk surat keluar. Kosong atau UUID kanonik
		// huruf kecil, persis bentuk yang dikirim API arahan — pencocokan di
		// detail arahan memakai perbandingan teks.
		if k == "rujukanArahanId" && value != "" && !rujukanArahanIDPattern.MatchString(value) {
			return false
		}
	}
	return true
}

var rujukanArahanIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func (a *API) UrminRegisterRoutes(r chi.Router) {
	r.Get("/", a.urminregisterList)
	r.Post("/", a.urminregisterCreate)
	r.Get("/{id}", a.urminregisterDetail)
	r.Patch("/{id}", a.urminregisterUpdate)
	r.Delete("/{id}", a.urminregisterDelete)
	r.Get("/{id}/workflow", a.outgoingWorkflow)
	r.Post("/{id}/submit", a.outgoingSubmit)
	r.Post("/{id}/approve", a.outgoingDecision(true))
	r.Post("/{id}/reject", a.outgoingDecision(false))
}

const urminregisterSelect = `SELECT s.id::text,s.kind,s.ref_code,s.title,w.classification,s.fields,s.work_record_id::text,w.created_by::text,s.version,s.created_at,COALESCE(o.stage,'draft') FROM sdl_urmin_registry s JOIN sdl_unit_work_records w ON w.id=s.work_record_id LEFT JOIN sdl_outgoing_workflows o ON o.register_id=s.id`

func scanUrminRegister(row interface{ Scan(...any) error }) (urminregisterRow, error) {
	var p urminregisterRow
	var body []byte
	err := row.Scan(&p.ID, &p.Kind, &p.Code, &p.Title, &p.Classification, &body, &p.WorkRecordID, &p.Owner, &p.Version, &p.CreatedAt, &p.WorkflowStatus)
	if err == nil {
		err = json.Unmarshal(body, &p.Fields)
	}
	return p, err
}
func (a *API) urminregisterOwned(ctx context.Context, id, action string) (urminregisterRow, error) {
	p, err := scanUrminRegister(a.DB.QueryRow(ctx, urminregisterSelect+` WHERE s.id::text=$1 AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.unit_key='urmin'`, id))
	if err != nil {
		return p, err
	}
	ok, err := a.permit(ctx, "urmin", p.Classification, p.Owner, p.WorkRecordID, action)
	if err != nil {
		return p, err
	}
	if !ok {
		return p, errUrminRegisterDenied
	}
	return p, nil
}

var errUrminRegisterDenied = errors.New("urminregister_access_denied")

func urminregisterError(w http.ResponseWriter, err error) {
	if errors.Is(err, errUrminRegisterDenied) {
		fail(w, 403, "access_denied")
		return
	}
	sqlerr(w, err)
}
func (a *API) urminregisterList(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	if _, ok := urminregisterFields[kind]; !ok {
		fail(w, 400, "invalid_kind")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) > 100 {
		fail(w, 400, "invalid_search")
		return
	}
	// R5G7: arsip terbagi dua — yang diinput manual, dan yang lahir dari
	// pengarsipan disposisi (endpoint 143). Pembedanya `fields->>'sumber'`,
	// yang hanya ditulis oleh endpoint 143.
	//
	// Disaring di SQL, bukan sesudahnya: daftar ini memotong di 100 baris
	// SETELAH penyaringan izin, jadi arsip manual bisa terdorong keluar jendela
	// begitu entri disposisi menumpuk. Menyaring di sini membuat tiap kategori
	// punya 100 barisnya sendiri.
	//
	// Entri lama tidak punya kunci 'sumber' sama sekali, dan IS DISTINCT FROM
	// memperlakukan NULL itu sebagai manual — tanpa backfill apa pun.
	source := strings.TrimSpace(r.URL.Query().Get("source"))
	if source != "" && source != "manual" && source != "disposisi" {
		fail(w, 400, "invalid_source")
		return
	}
	rows, err := a.DB.Query(r.Context(), urminregisterSelect+` WHERE s.kind=$1 AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.unit_key='urmin' AND ($2='' OR s.title ILIKE '%'||$2||'%' OR s.ref_code ILIKE '%'||$2||'%') AND ($3='' OR ($3='disposisi') = (s.fields->>'sumber' IS NOT DISTINCT FROM 'disposisi')) ORDER BY s.created_at DESC,s.id DESC LIMIT 251`, kind, q, source)
	if err != nil {
		sqlerr(w, err)
		return
	}
	items := []urminregisterRow{}
	truncated := false
	for rows.Next() {
		p, e := scanUrminRegister(rows)
		if e != nil {
			err = e
			break
		}
		allowed, e := a.permit(r.Context(), "urmin", p.Classification, p.Owner, p.WorkRecordID, "read")
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
func (a *API) urminregisterDetail(w http.ResponseWriter, r *http.Request) {
	p, err := a.urminregisterOwned(r.Context(), chi.URLParam(r, "id"), "read")
	if err != nil {
		urminregisterError(w, err)
		return
	}
	respond(w, 200, p)
}
func (a *API) urminregisterCreate(w http.ResponseWriter, r *http.Request) {
	var v urminregisterInput
	if !decode(w, r, &v) {
		return
	}
	if !urminregisterValid(v) || (v.Kind == "surat_keluar" && v.Fields["statusAdministrasi"] != "" && v.Fields["statusAdministrasi"] != "Draft") {
		fail(w, 400, "invalid_urminregister_record")
		return
	}
	ok, err := a.permit(r.Context(), "urmin", v.Classification, who(r.Context()), "", "create")
	if err != nil {
		sqlerr(w, err)
		return
	}
	if !ok {
		fail(w, 403, "access_denied")
		return
	}
	// R5G13: surat keluar menerima nomornya di sini, saat draf dibuat.
	// Keputusan pemilik sistem, berikut konsekuensinya: draf yang batal
	// meninggalkan lubang pada deret, dan lubang itu tidak diisi ulang.
	if v.Kind == "surat_keluar" {
		if code := nomorSuratKurang(v.Fields); code != "" {
			fail(w, 400, code)
			return
		}
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	// Perakitan berada DI DALAM transaksi: kalau penyimpanan suratnya gagal,
	// nomor yang terlanjur diambil ikut dibatalkan. Tanpa itu setiap kegagalan
	// penyimpanan akan membakar satu nomor.
	if v.Kind == "surat_keluar" {
		nomor, e := rakitNomorSurat(r.Context(), tx, v.Fields, time.Now())
		if e != nil {
			sqlerr(w, e)
			return
		}
		v.Fields["nomorSurat"] = nomor
	}
	body, _ := json.Marshal(v.Fields)
	var workID, id string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_unit_work_records(unit_key,category,title,description,classification,created_by,updated_by) VALUES('urmin',$1,$2,'',$3,$4::uuid,$4::uuid) RETURNING id::text`, "Register Urmin "+v.Kind, strings.TrimSpace(v.Title), v.Classification, who(r.Context())).Scan(&workID)
	if err == nil {
		err = tx.QueryRow(r.Context(), `INSERT INTO sdl_urmin_registry(kind,ref_code,title,fields,work_record_id,created_by,updated_by) VALUES($1,$2,$3,$4::jsonb,$5::uuid,$6::uuid,$6::uuid) RETURNING id::text`, v.Kind, strings.TrimSpace(v.Code), strings.TrimSpace(v.Title), string(body), workID, who(r.Context())).Scan(&id)
	}
	if err == nil && v.Kind == "surat_keluar" {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_outgoing_workflows(register_id) VALUES($1::uuid)`, id)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'created',$3)`, workID, who(r.Context()), "Register Urmin: "+v.Kind)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		urminregisterWriteError(w, err)
		return
	}
	respond(w, 201, map[string]string{"id": id, "workRecordId": workID})
}
func urminregisterWriteError(w http.ResponseWriter, err error) {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		fail(w, 409, "duplicate_code")
		return
	}
	sqlerr(w, err)
}
func (a *API) urminregisterUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := a.urminregisterOwned(r.Context(), id, "edit")
	if err != nil {
		urminregisterError(w, err)
		return
	}
	var v urminregisterInput
	if !decode(w, r, &v) {
		return
	}
	if !urminregisterValid(v) || v.Kind != p.Kind || v.Version < 1 || (v.Kind == "surat_keluar" && v.Fields["statusAdministrasi"] != "" && v.Fields["statusAdministrasi"] != "Draft") {
		fail(w, 400, "invalid_urminregister_record")
		return
	}
	ok, err := a.permit(r.Context(), "urmin", v.Classification, p.Owner, p.WorkRecordID, "edit")
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
	if v.Kind == "surat_keluar" {
		if err = lockOutgoingEditing(r.Context(), tx, p.WorkRecordID); err != nil {
			if errors.Is(err, errOutgoingLocked) {
				fail(w, 409, "outgoing_locked")
			} else {
				sqlerr(w, err)
			}
			return
		}
	}
	cmd, err := tx.Exec(r.Context(), `UPDATE sdl_urmin_registry SET ref_code=$3,title=$4,fields=$5::jsonb,version=version+1,updated_by=$6::uuid,updated_at=now() WHERE id::text=$1 AND kind=$2 AND deleted_at IS NULL AND version=$7`, id, v.Kind, strings.TrimSpace(v.Code), strings.TrimSpace(v.Title), string(body), who(r.Context()), v.Version)
	if err == nil && cmd.RowsAffected() != 1 {
		fail(w, 409, "stale_version")
		return
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE sdl_unit_work_records SET title=$2,classification=$3,updated_by=$4::uuid,version=version+1,updated_at=now() WHERE id::text=$1 AND deleted_at IS NULL`, p.WorkRecordID, strings.TrimSpace(v.Title), v.Classification, who(r.Context()))
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'updated','Register Urmin diperbarui')`, p.WorkRecordID, who(r.Context()))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		urminregisterWriteError(w, err)
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}
func (a *API) urminregisterDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := a.urminregisterOwned(r.Context(), id, "delete")
	if err != nil {
		urminregisterError(w, err)
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if p.Kind == "surat_keluar" {
		if err = lockOutgoingEditing(r.Context(), tx, p.WorkRecordID); err != nil {
			if errors.Is(err, errOutgoingLocked) {
				fail(w, 409, "outgoing_locked")
			} else {
				sqlerr(w, err)
			}
			return
		}
	}
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
	cmd, err := tx.Exec(r.Context(), `UPDATE sdl_urmin_registry SET deleted_at=now(),updated_by=$2::uuid,updated_at=now() WHERE id::text=$1 AND deleted_at IS NULL`, id, who(r.Context()))
	if err == nil && cmd.RowsAffected() != 1 {
		fail(w, 409, "already_removed")
		return
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE sdl_unit_work_records SET deleted_at=now(),updated_by=$2::uuid,updated_at=now() WHERE id::text=$1`, p.WorkRecordID, who(r.Context()))
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note) VALUES($1::uuid,$2::uuid,'deleted','Register Urmin diarsipkan')`, p.WorkRecordID, who(r.Context()))
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
