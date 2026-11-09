package unitwork

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// R5G12: pengelolaan master data persuratan oleh Superadmin.
//
// Himpunan yang dikelola (R5H2 menambah yang ketiga, disposisi):
//
//	jenis-surat  -> sdl_surat_jenis       (ND = Nota Dinas, dst.)
//	kode-arsip   -> sdl_surat_kode_arsip  (HUM.1.2. = BUKU TAMU, dst.)
//
// Derajat dan klasifikasi TIDAK ada di sini, atas keputusan pemilik sistem dan
// dengan alasan yang berbeda untuk masing-masing. Derajat terikat CHECK
// constraint di `sdl_urmin_incoming` (migrasi 034), sehingga "bisa dikelola"
// hanya akan jadi ilusi: menambah nilai ketiga tetap menuntut migrasi.
// Klasifikasi lebih serius — ia yang dibaca permit() untuk memutuskan siapa
// boleh membuka dokumen, jadi menjadikannya data yang bisa disunting berarti
// satu salah klik di Settings menggeser hak akses di empat unit sekaligus.
//
// Keduanya di balik guard Superadmin (AuthorizeRoleEditor), bukan guard
// operasional. Ini konfigurasi, bukan pekerjaan unit — dan Superadmin memang
// administrator identitas serta konfigurasi, bukan pengguna operasional.

type masterSet struct {
	table   string
	codeRe  *regexp.Regexp
	nameMax int
	// Query EXISTS dengan satu parameter ($1 = kode) yang menjawab "apakah
	// kode ini masih terpakai". Dipakai menolak penghapusan kode yang masih
	// dirujuk; nilainya konstanta di bawah, tidak pernah berasal dari request.
	inUseSQL string
	// R5H3: nama tidak boleh memuat koma, karena di surat ia digabung ", "
	// dengan nama lain (daftar pilih-banyak). Ditolak 400 invalid_name di sini,
	// bukan dibiarkan jatuh ke CHECK constraint migrasi 042.
	noComma bool
}

// Kode jenis surat dan kode arsip tersimpan sebagai teks di JSONB surat.
func registryUse(field string) string {
	return `SELECT EXISTS(SELECT 1 FROM sdl_urmin_registry WHERE deleted_at IS NULL AND fields->>'` + field + `'=$1)`
}

var masterSets = map[string]masterSet{
	"jenis-surat": {
		table:    "sdl_surat_jenis",
		codeRe:   regexp.MustCompile(`^[A-Z0-9][A-Z0-9/-]{0,11}$`),
		nameMax:  120,
		inUseSQL: registryUse("jenisSurat"),
	},
	"kode-arsip": {
		table:    "sdl_surat_kode_arsip",
		codeRe:   regexp.MustCompile(`^[A-Z]{2,5}(\.[0-9]+)+\.$`),
		nameMax:  250,
		inUseSQL: registryUse("kodeArsip"),
	},
	// R5H2: pilihan centang "Disposisi Kabagrenmin" pada arahan (migrasi 041).
	// Kodenya tersimpan di larik `dispositions` dalam JSONB `sheet`. Hanya arahan
	// TERKIRIM yang menahan penghapusan: draf yang ditinggalkan tidak boleh
	// mengunci opsi selamanya, dan layar penyusun melepas kode yang sudah tidak
	// ada saat draf dibuka ulang (kirim tetap ditolak 400 oleh sheetAllowed).
	"disposisi": {
		table:    "sdl_disposisi_opsi",
		codeRe:   regexp.MustCompile(`^[A-Z][A-Z0-9_]{1,23}$`),
		nameMax:  120,
		inUseSQL: `SELECT EXISTS(SELECT 1 FROM sdl_leadership_directives WHERE sheet->'dispositions' ? $1)`,
	},
}

type masterInput struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

type masterRow struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

func masterPick(w http.ResponseWriter, r *http.Request) (masterSet, string, bool) {
	name := chi.URLParam(r, "set")
	set, ok := masterSets[name]
	if !ok {
		fail(w, 404, "not_found")
		return masterSet{}, "", false
	}
	return set, name, true
}

func (a *API) masterList(w http.ResponseWriter, r *http.Request) {
	set, _, ok := masterPick(w, r)
	if !ok {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) > 100 {
		fail(w, 400, "invalid_search")
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT code,name FROM `+set.table+
		` WHERE ($1='' OR name ILIKE '%'||$1||'%' OR code ILIKE '%'||$1||'%')
		  ORDER BY code LIMIT 201`, q)
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer rows.Close()
	items := []masterRow{}
	for rows.Next() {
		var v masterRow
		if rows.Scan(&v.Code, &v.Name) != nil {
			fail(w, 503, "database_unavailable")
			return
		}
		items = append(items, v)
	}
	if rows.Err() != nil {
		fail(w, 503, "database_unavailable")
		return
	}
	limited := len(items) > 200
	if limited {
		items = items[:200]
	}
	respond(w, 200, map[string]any{"items": items, "limited": limited})
}

func masterBody(w http.ResponseWriter, r *http.Request, set masterSet) (masterInput, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var v masterInput
	if dec.Decode(&v) != nil || dec.Decode(new(any)) != io.EOF {
		fail(w, 400, "invalid_request")
		return masterInput{}, false
	}
	v.Code = strings.ToUpper(strings.TrimSpace(v.Code))
	v.Name = strings.Join(strings.Fields(v.Name), " ")
	if !set.codeRe.MatchString(v.Code) {
		fail(w, 400, "invalid_code")
		return masterInput{}, false
	}
	if n := len([]rune(v.Name)); n < 2 || n > set.nameMax || (set.noComma && strings.Contains(v.Name, ",")) {
		fail(w, 400, "invalid_name")
		return masterInput{}, false
	}
	return v, true
}

func (a *API) masterCreate(w http.ResponseWriter, r *http.Request) {
	set, name, ok := masterPick(w, r)
	if !ok {
		return
	}
	v, ok := masterBody(w, r, set)
	if !ok {
		return
	}
	var err error
	if name == "kode-arsip" {
		// prefix dan depth diturunkan dari kodenya, bukan diminta ke pemanggil:
		// keduanya selalu bisa dihitung dan meminta keduanya hanya membuka
		// peluang mereka tidak cocok dengan kodenya.
		prefix, depth := kodeArsipParts(v.Code)
		_, err = a.DB.Exec(r.Context(), `INSERT INTO sdl_surat_kode_arsip(code,name,prefix,depth) VALUES($1,$2,$3,$4)`, v.Code, v.Name, prefix, depth)
	} else {
		_, err = a.DB.Exec(r.Context(), `INSERT INTO `+set.table+`(code,name) VALUES($1,$2)`, v.Code, v.Name)
	}
	if err != nil {
		if isUniqueViolation(err) {
			fail(w, 409, "duplicate")
			return
		}
		sqlerr(w, err)
		return
	}
	respond(w, 201, masterRow{Code: v.Code, Name: v.Name})
}

func (a *API) masterUpdate(w http.ResponseWriter, r *http.Request) {
	set, name, ok := masterPick(w, r)
	if !ok {
		return
	}
	code := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "code")))
	if !set.codeRe.MatchString(code) {
		fail(w, 404, "not_found")
		return
	}
	v, ok := masterBody(w, r, set)
	if !ok {
		return
	}
	// Kodenya tidak bisa diubah lewat PATCH; ia kunci primer dan sudah
	// tercetak di nomor surat yang terlanjur terbit. Mengganti nama cukup.
	if v.Code != code {
		fail(w, 400, "code_immutable")
		return
	}
	var tag interface{ RowsAffected() int64 }
	var err error
	if name == "kode-arsip" {
		tag, err = a.DB.Exec(r.Context(), `UPDATE sdl_surat_kode_arsip SET name=$2 WHERE code=$1`, code, v.Name)
	} else {
		tag, err = a.DB.Exec(r.Context(), `UPDATE `+set.table+` SET name=$2,updated_at=now() WHERE code=$1`, code, v.Name)
	}
	if err != nil {
		if isUniqueViolation(err) {
			fail(w, 409, "duplicate")
			return
		}
		sqlerr(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		fail(w, 404, "not_found")
		return
	}
	respond(w, 200, masterRow{Code: code, Name: v.Name})
}

func (a *API) masterDelete(w http.ResponseWriter, r *http.Request) {
	set, _, ok := masterPick(w, r)
	if !ok {
		return
	}
	code := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "code")))
	if !set.codeRe.MatchString(code) {
		fail(w, 404, "not_found")
		return
	}
	// Tidak ada foreign key dari surat ke master ini — kodenya tersimpan
	// sebagai teks di JSONB. Karena itu penghapusan tidak merusak surat yang
	// sudah ada, TAPI membuat kodenya yatim: tercetak di nomor surat tanpa
	// keterangan apa pun di master. Ditolak selama masih terpakai.
	var used bool
	err := a.DB.QueryRow(r.Context(), set.inUseSQL, code).Scan(&used)
	if err != nil {
		sqlerr(w, err)
		return
	}
	if used {
		fail(w, 409, "code_in_use")
		return
	}
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM `+set.table+` WHERE code=$1`, code)
	if err != nil {
		sqlerr(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		fail(w, 404, "not_found")
		return
	}
	respond(w, 200, map[string]bool{"deleted": true})
}

func (a *API) MasterDataRoutes(r chi.Router) {
	r.Get("/master/{set}", a.masterList)
	r.Post("/master/{set}", a.masterCreate)
	r.Patch("/master/{set}/{code}", a.masterUpdate)
	r.Delete("/master/{set}/{code}", a.masterDelete)
}

// Prefiks dan kedalaman kode arsip, diturunkan dari bentuk kodenya sendiri.
// "HUM.1.2." -> ("HUM", 2)
func kodeArsipParts(code string) (string, int) {
	parts := strings.Split(strings.TrimSuffix(code, "."), ".")
	depth := 0
	for _, p := range parts[1:] {
		if p != "" {
			depth++
		}
	}
	return parts[0], depth
}

func isUniqueViolation(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}
