package unitwork

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
)

var kodeArsipPrefix = regexp.MustCompile(`^[A-Z]{2,5}$`)

// R5G10: pencarian master kode klasifikasi arsip untuk penomoran surat dinas.
//
// Dipakai pada segmen keempat nomor surat:
//
//	B/ND-157/X/HUM.1.2./2026/Bagrenmin
//	           ^^^^^^^^
//
// Arah pencariannya NAMA -> KODE, bukan sebaliknya: petugas mengetik "buku
// tamu" dan sistem menjawab HUM.1.2.. Kodenya tetap bisa dicari langsung untuk
// yang sudah hafal, tapi itu bonus, bukan alur utamanya.
//
// Tabelnya data referensi murni — tanpa kepemilikan, klasifikasi akses, atau
// jejak audit. Karena itu endpoint ini hanya berada di balik guard operasional
// dan tidak memanggil permit(): tidak ada yang bisa dilanggar, dan setiap akun
// yang boleh menyusun surat memang perlu membacanya.

const kodeArsipLimit = 50

type kodeArsipRow struct {
	Code  string `json:"code"`
	Name  string `json:"name"`
	Depth int    `json:"depth"`
}

func (a *API) kodeArsipList(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) > 100 {
		fail(w, 400, "invalid_search")
		return
	}
	prefix := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("prefix")))
	if prefix != "" && !kodeArsipPrefix.MatchString(prefix) {
		fail(w, 400, "invalid_prefix")
		return
	}

	// Dibatasi 50 dan diurut kode supaya hasilnya tetap bisa ditebak. Pencarian
	// kosong mengembalikan 50 pertama, bukan seluruh 701 baris: daftar sepanjang
	// itu tidak menolong siapa pun di kotak pencarian.
	//
	// LIMIT 51 = kodeArsipLimit + 1, satu baris lebih untuk mendeteksi sisa.
	rows, err := a.DB.Query(r.Context(), `SELECT code,name,depth FROM sdl_surat_kode_arsip
 WHERE ($1='' OR name ILIKE '%'||$1||'%' OR code ILIKE '%'||$1||'%')
   AND ($2='' OR prefix=$2)
 ORDER BY code LIMIT 51`, q, prefix)
	if err != nil {
		sqlerr(w, err)
		return
	}
	defer rows.Close()
	items := []kodeArsipRow{}
	for rows.Next() {
		var v kodeArsipRow
		if rows.Scan(&v.Code, &v.Name, &v.Depth) != nil {
			fail(w, 503, "database_unavailable")
			return
		}
		items = append(items, v)
	}
	if rows.Err() != nil {
		fail(w, 503, "database_unavailable")
		return
	}
	// Satu baris lebih diambil hanya untuk tahu apakah masih ada sisanya; ia
	// tidak ikut dikirim.
	truncated := len(items) > kodeArsipLimit
	if truncated {
		items = items[:kodeArsipLimit]
	}
	respond(w, 200, map[string]any{"items": items, "limited": truncated})
}

func (a *API) KodeArsipRoutes(r chi.Router) {
	r.Get("/", a.kodeArsipList)
}

// R5G12: daftar jenis surat untuk formulir surat keluar. Guard operasional,
// sama alasannya dengan kode arsip — data referensi yang sama untuk semua unit.
//
// Tanpa pencarian dan tanpa batas: daftarnya pendek (satu baris per 2026-11-03)
// dan memang dimaksudkan tampil seluruhnya sebagai dropdown.
func (a *API) jenisSuratList(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `SELECT code,name FROM sdl_surat_jenis ORDER BY code`)
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
	respond(w, 200, map[string]any{"items": items})
}

func (a *API) JenisSuratRoutes(r chi.Router) {
	r.Get("/", a.jenisSuratList)
}
