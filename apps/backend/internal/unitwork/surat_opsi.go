package unitwork

import (
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
)

// R5H3: enam daftar pilihan dropdown formulir Surat Keluar (migrasi 042).
//
// Satu sumber untuk dua hal: Master Data Superadmin (didaftarkan ke masterSets
// di init di bawah) dan daftar baca operasional GET /api/v1/urmin/surat-opsi/.
//
// Padanan Express: apps/backend-express/src/modules/unitwork/surat-opsi.js.
type suratOpsi struct {
	set   string // kunci Master Data: /api/v1/admin/master/{set}
	field string // kunci di sdl_urmin_registry.fields dan di respons baca
	table string
	multi bool // nilai tersimpan berupa nama-nama digabung ", "
}

var suratOpsiList = []suratOpsi{
	{set: "jalur-surat", field: "jalurSurat", table: "sdl_surat_jalur"},
	{set: "penandatangan", field: "penandatangan", table: "sdl_surat_penandatangan"},
	{set: "pemberi-nomor", field: "pemberiNomor", table: "sdl_surat_pemberi_nomor"},
	{set: "verifikator", field: "verifikator", table: "sdl_surat_verifikator", multi: true},
	{set: "tembusan", field: "tembusan", table: "sdl_surat_tembusan", multi: true},
	{set: "tipe-surat", field: "tipeSurat", table: "sdl_surat_tipe"},
}

// Surat menyimpan NAMA pilihan, jadi "masih dipakai" berarti ada surat keluar
// aktif yang isiannya sama dengan nama kode itu saat ini. Untuk daftar pilih-
// banyak, nama dicari di antara nilai yang digabung ", ".
func suratOpsiInUse(o suratOpsi) string {
	match := `r.fields->>'` + o.field + `'=x.name`
	if o.multi {
		match = `x.name=ANY(string_to_array(r.fields->>'` + o.field + `', ', '))`
	}
	return `SELECT EXISTS(SELECT 1 FROM sdl_urmin_registry r JOIN ` + o.table + ` x ON x.code=$1
	 WHERE r.deleted_at IS NULL AND r.kind='surat_keluar' AND ` + match + `)`
}

func init() {
	for _, o := range suratOpsiList {
		masterSets[o.set] = masterSet{
			table:    o.table,
			codeRe:   regexp.MustCompile(`^[A-Z][A-Z0-9_]{1,23}$`),
			nameMax:  120,
			inUseSQL: suratOpsiInUse(o),
			noComma:  o.multi,
		}
	}
}

// Urutan field = urutan kunci di respons; surat-opsi.js wajib sama.
type suratOpsiResponse struct {
	JalurSurat    []masterRow `json:"jalurSurat"`
	Penandatangan []masterRow `json:"penandatangan"`
	PemberiNomor  []masterRow `json:"pemberiNomor"`
	Verifikator   []masterRow `json:"verifikator"`
	Tembusan      []masterRow `json:"tembusan"`
	TipeSurat     []masterRow `json:"tipeSurat"`
}

// Guard operasional saja, alasan yang sama dengan jenis surat: data referensi
// yang sama untuk semua unit dan dibutuhkan setiap akun yang menyusun surat.
func (a *API) suratOpsiList(w http.ResponseWriter, r *http.Request) {
	out := suratOpsiResponse{}
	targets := []*[]masterRow{&out.JalurSurat, &out.Penandatangan, &out.PemberiNomor, &out.Verifikator, &out.Tembusan, &out.TipeSurat}
	for i, o := range suratOpsiList {
		rows, err := a.DB.Query(r.Context(), `SELECT code,name FROM `+o.table+` ORDER BY name`)
		if err != nil {
			sqlerr(w, err)
			return
		}
		items := []masterRow{}
		for rows.Next() {
			var v masterRow
			if rows.Scan(&v.Code, &v.Name) != nil {
				rows.Close()
				fail(w, 503, "database_unavailable")
				return
			}
			items = append(items, v)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			fail(w, 503, "database_unavailable")
			return
		}
		*targets[i] = items
	}
	respond(w, 200, out)
}

func (a *API) SuratOpsiRoutes(r chi.Router) {
	r.Get("/", a.suratOpsiList)
}
