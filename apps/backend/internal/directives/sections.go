package directives

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

// R5H1 — penunjukan arahan lewat BAGIAN.
//
// Kabagrenmin tidak menunjuk orang, ia menunjuk bagian. Berkas ini satu-satunya
// tempat daftar bagian itu hidup di backend Go; padanannya di Express ada di
// modules/directives/sections.js dan HARUS sama persis isinya.
//
// Kenapa daftarnya di kode, bukan tabel:
//
//   - 'bagian' bukan unit. sdl_org_units hanya punya empat baris (urmin,
//     subbagren, subbagsumda, subbagbinfung), dan 'kasubbagurmin' maupun
//     'kabagrenmin' sama-sama berada di unit 'urmin'. Tabel unit tidak bisa
//     membedakan jabatan di dalam satu unit.
//   - Peta bagian -> (unit, role) adalah keputusan struktur organisasi, bukan
//     data operasional. Memindahkannya ke tabel berarti Role Editor bisa
//     mengubah tujuan arahan tanpa seorang pun meninjau, dan itu persis jenis
//     perubahan yang ingin kita paksa lewat tinjauan kode.
//
// Pola yang sama sudah dipakai isKabag(), yang menuntut role_key
// 'br_kabagrenmin' secara harfiah.
// R5H4 — tiga JENIS pilihan, bukan satu.
//
//	jabatan  hanya pemegang role kepala bagian (perilaku R5H1, tidak berubah)
//	bagian   SELURUH anggota unit: kepala, operator, dan staf
//	paur     anggota satu Paur di Subbagsumda (sdl_user_paur, migrasi 043)
//
// Kunci 'kasubbag*' tetap persis seperti R5H1, supaya draf dan arahan lama
// tetap terbaca dengan arti yang sama.
type section struct {
	Key   string
	Label string
	Kind  string // "jabatan" | "bagian" | "paur"
	Unit  string
	// Role untuk 'jabatan', kunci Paur untuk 'paur', kosong untuk 'bagian'.
	Role string
}

const (
	kindJabatan = "jabatan"
	kindBagian  = "bagian"
	kindPaur    = "paur"
)

var sections = []section{
	{"kasubbagren", "Kasubbagren", kindJabatan, "subbagren", "br_kasubbagren"},
	{"kasubbagsumda", "Kasubbagsumda", kindJabatan, "subbagsumda", "br_kasubbagsumda"},
	{"kasubbagbinfung", "Kasubbagbinfung", kindJabatan, "subbagbinfung", "br_kasubbagbinfung"},
	// Kepala Urmin. Nama role-nya 'br_ka_urmin', bukan 'br_kasubbagurmin' --
	// begitulah seed menamainya sejak awal, dan mengganti role_key akan
	// mencabut grant seluruh akun yang memegangnya.
	{"kasubbagurmin", "Kaurmin", kindJabatan, "urmin", "br_ka_urmin"},
	{"subbagren", "Subbagren", kindBagian, "subbagren", ""},
	{"subbagsumda", "Subbagsumda", kindBagian, "subbagsumda", ""},
	{"subbagbinfung", "Subbagbinfung", kindBagian, "subbagbinfung", ""},
	{"urmin", "Urmin", kindBagian, "urmin", ""},
	// Kunci yang sama dengan baris sdl_paur di migrasi 043.
	{"paur_sumda", "Paur Sumda", kindPaur, "subbagsumda", "paur_sumda"},
	{"paur_log", "Paur Log", kindPaur, "subbagsumda", "paur_log"},
	{"paur_ada", "Paur ADA", kindPaur, "subbagsumda", "paur_ada"},
}

func sectionByKey(key string) (section, bool) {
	for _, s := range sections {
		if s.Key == key {
			return s, true
		}
	}
	return section{}, false
}

// Dipenuhi baik oleh *pgxpool.Pool maupun pgx.Tx, sehingga pemilihan bagian
// dibaca dengan SQL yang sama saat menampilkan pilihan dan saat mengirim.
// Dua salinan query ini pernah menjadi sumber "terlihat boleh di layar, 400
// saat dikirim" di modul lain; di sini hanya ada satu.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type sectionHolder struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Keduanya menjawab "boleh menerima distribusi SURAT", bukan "boleh
	// menerima arahan". Sejak R5H4 klasifikasi tidak lagi menentukan siapa
	// menerima arahan; ia hanya menentukan siapa yang ikut menerima suratnya.
	CanReceiveBiasa   bool `json:"canReceiveBiasa"`
	CanReceivePenting bool `json:"canReceivePenting"`
}

type sectionItem struct {
	Key     string          `json:"key"`
	Label   string          `json:"label"`
	Kind    string          `json:"kind"`
	Unit    string          `json:"unit"`
	Holders []sectionHolder `json:"holders"`
	// Agregat semua-atau-tidak-sama-sekali, dipertahankan dari R5H1: true hanya
	// kalau SELURUH anggota pilihan ini boleh menerima suratnya. Sejak R5H4
	// nilai false tidak lagi menghalangi pengiriman -- anggota yang tidak
	// berwenang menerima arahannya tanpa suratnya. Layar memakainya sebagai
	// keterangan, bukan untuk menonaktifkan pilihan.
	LetterBiasa   bool `json:"letterBiasa"`
	LetterPenting bool `json:"letterPenting"`
}

// Satu query untuk ketiga jenis pilihan. Setiap baris 's' adalah satu pilihan;
// anggota dihitung dari keanggotaan unit (sdl_user_units) ditambah grant aktif
// DI UNIT ITU, lalu disaring menurut jenisnya:
//
//	jabatan  wajib memegang grant role kepala (scope unit/assigned) -- syarat R5H1
//	paur     wajib tercatat di sdl_user_paur untuk Paur itu
//	bagian   tanpa saringan tambahan
//
// Kemampuan menerima surat (dua bool_or) dihitung atas SEMUA grant orang itu
// di unit tersebut, dengan syarat yang sama dengan urmin.recipientEligible:
// izin 'urmin.distribusi.receive' pada grant ber-scope unit/assigned. Itulah
// pemeriksaan yang dijalankan modul Urmin saat surat dibuka, jadi layar tidak
// menjanjikan akses yang nanti ditolak.
//
// Gerbang orang -- aktif, password sudah dirotasi, bukan Superadmin, bukan
// Kabagrenmin, bukan diri sendiri -- tidak berubah dari R5H1.
const sectionHoldersSQL = `SELECT s.section_key,u.id::text,u.display_name,
  bool_or(rp.permission_key IS NOT NULL AND g.scope IN ('unit','assigned')),
  bool_or(rp.permission_key IS NOT NULL AND g.scope IN ('unit','assigned') AND g.classification_limit='penting')
 FROM unnest($2::text[],$3::text[],$4::text[],$5::text[]) AS s(section_key,kind,unit_key,ref)
 JOIN sdl_org_units ou ON ou.unit_key=s.unit_key AND ou.is_active
 JOIN sdl_user_units uu ON uu.unit_key=s.unit_key
 JOIN sdl_users u ON u.id=uu.user_id
 JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=s.unit_key
   AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW())
 JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
 LEFT JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key='urmin.distribusi.receive'
 WHERE u.is_active AND NOT u.must_change_password AND u.id<>$1::uuid
   AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin')
   AND NOT EXISTS(SELECT 1 FROM sdl_access_grants kb WHERE kb.user_id=u.id AND kb.role_key='br_kabagrenmin'
     AND kb.revoked_at IS NULL AND (kb.expires_at IS NULL OR kb.expires_at>NOW()))
   AND (s.kind<>'jabatan' OR EXISTS(SELECT 1 FROM sdl_access_grants j JOIN sdl_roles jr ON jr.role_key=j.role_key AND jr.is_active
     WHERE j.user_id=u.id AND j.role_key=s.ref AND j.unit_key=s.unit_key AND j.scope IN ('unit','assigned')
       AND j.revoked_at IS NULL AND (j.expires_at IS NULL OR j.expires_at>NOW())))
   AND (s.kind<>'paur' OR EXISTS(SELECT 1 FROM sdl_user_paur p WHERE p.user_id=u.id AND p.paur_key=s.ref))
 GROUP BY s.section_key,u.id,u.display_name
 ORDER BY s.section_key,u.display_name`

func sectionArgs() (keys, kinds, units, refs []string) {
	for _, s := range sections {
		keys = append(keys, s.Key)
		kinds = append(kinds, s.Kind)
		units = append(units, s.Unit)
		refs = append(refs, s.Role)
	}
	return
}

// Selalu mengembalikan seluruh pilihan, termasuk yang tidak punya anggota sama
// sekali (Holders kosong). Pilihan yang hilang dari daftar akan terbaca di
// layar sebagai "menu berubah"; pilihan kosong terbaca sebagai "belum ada
// orangnya", yang memang keadaannya -- misalnya Paur yang belum diisi.
func readSections(ctx context.Context, q querier, actor string) ([]sectionItem, error) {
	keys, kinds, units, refs := sectionArgs()
	rows, err := q.Query(ctx, sectionHoldersSQL, actor, keys, kinds, units, refs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byKey := map[string][]sectionHolder{}
	for rows.Next() {
		var key string
		var h sectionHolder
		if err = rows.Scan(&key, &h.ID, &h.Name, &h.CanReceiveBiasa, &h.CanReceivePenting); err != nil {
			return nil, err
		}
		byKey[key] = append(byKey[key], h)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	items := make([]sectionItem, 0, len(sections))
	for _, s := range sections {
		holders := byKey[s.Key]
		if holders == nil {
			holders = []sectionHolder{}
		}
		item := sectionItem{Key: s.Key, Label: s.Label, Kind: s.Kind, Unit: s.Unit, Holders: holders,
			LetterBiasa: len(holders) > 0, LetterPenting: len(holders) > 0}
		for _, h := range holders {
			item.LetterBiasa = item.LetterBiasa && h.CanReceiveBiasa
			item.LetterPenting = item.LetterPenting && h.CanReceivePenting
		}
		items = append(items, item)
	}
	return items, nil
}

// Pilihan tanpa anggota (misalnya Paur yang belum diisi). Dibedakan dari kegagalan database supaya
// pemanggil bisa menjawab 400 ("pilihan ini tidak bisa dikirimi") alih-alih
// 503 ("layanan sedang rusak").
var errSectionVacant = errors.New("section_vacant")

type resolved struct {
	UserID  string
	Section string
	Unit    string
}

// Menerjemahkan pilihan bagian menjadi daftar orang, di dalam transaksi kirim.
//
// Dijalankan di transaksi dan bukan di pool karena jabatan bisa berpindah
// tangan di antara saat layar memuat pilihan dan saat tombol kirim ditekan.
// Yang tercatat sebagai penerima adalah pemegang jabatan pada saat COMMIT,
// bukan pada saat layar dibuka.
func resolveSections(ctx context.Context, tx pgx.Tx, keys []string, actor string) ([]resolved, error) {
	items, err := readSections(ctx, tx, actor)
	if err != nil {
		return nil, err
	}
	index := map[string]sectionItem{}
	for _, it := range items {
		index[it.Key] = it
	}
	out := make([]resolved, 0, len(keys))
	// Satu orang bisa memegang dua jabatan sekaligus -- pejabat sementara yang
	// merangkap, misalnya. Tanpa penyaringan ini ia menghasilkan dua baris
	// penerima dengan recipient_id sama, melanggar PRIMARY KEY
	// (directive_id, recipient_id), dan pengiriman gagal 503 tanpa petunjuk
	// apa pun tentang sebabnya. Bagian pertama yang menyebutnya yang dicatat:
	// urutan 'keys' adalah urutan pilihan Kabagrenmin.
	seen := make(map[string]bool, len(keys))
	for _, key := range keys {
		it, ok := index[key]
		if !ok || len(it.Holders) == 0 {
			return nil, errSectionVacant
		}
		for _, h := range it.Holders {
			if seen[h.ID] {
				continue
			}
			seen[h.ID] = true
			out = append(out, resolved{UserID: h.ID, Section: it.Key, Unit: it.Unit})
		}
	}
	return out, nil
}

// ---- 153. GET /leadership/directives/sections ----
func (a *API) sectionList(w http.ResponseWriter, r *http.Request) {
	actor := actor(r)
	kab, err := a.isKabag(r.Context(), actor)
	if err != nil {
		deny(w, 503)
		return
	}
	if !kab {
		deny(w, 403)
		return
	}
	items, err := readSections(r.Context(), a.DB, actor)
	if err != nil {
		deny(w, 503)
		return
	}
	respond(w, 200, map[string]any{"items": items})
}

type linkableLetter struct {
	ID             string  `json:"id"`
	AgendaNo       int64   `json:"agendaNo"`
	LetterNumber   string  `json:"letterNumber"`
	Sender         string  `json:"sender"`
	Subject        string  `json:"subject"`
	Classification string  `json:"classification"`
	Derajat        string  `json:"derajat"`
	LetterKind     string  `json:"letterKind"`
	LetterDate     string  `json:"letterDate"`
	ReceivedAt     *string `json:"receivedAt"`
	// Berapa arahan yang sudah pernah diterbitkan untuk surat ini oleh akun ini.
	// Surat tidak hilang dari daftar setelah diarahkan -- satu surat boleh punya
	// lebih dari satu arahan, misalnya saat bagian kedua baru ditunjuk belakangan.
	DirectiveCount int `json:"directiveCount"`
}

// Daftar surat yang boleh ditautkan, dengan syarat yang SAMA PERSIS seperti
// letterLinkAllowed di api.go: dirutekan ke Kabagrenmin ini dan sudah ia terima.
// Disusun dari syarat yang sama supaya daftar di layar tidak pernah memuat
// pilihan yang akan ditolak 400 saat dikirim.
const linkableLettersSQL = `SELECT i.id::text,i.agenda_no,i.letter_number,i.sender,i.subject,i.classification,i.derajat,
  it.letter_kind,i.letter_date::text,d.received_at::text,
  (SELECT COUNT(*) FROM sdl_leadership_directives ld WHERE ld.incoming_id=i.id AND ld.issuer_id=$1::uuid)::int
 FROM sdl_urmin_incoming_intake it
 JOIN sdl_urmin_incoming i ON i.id=it.incoming_id
 JOIN sdl_urmin_distributions d ON d.incoming_id=it.incoming_id AND d.recipient_user=$1::uuid AND d.status='received'
 WHERE it.kabag_recipient=$1::uuid AND it.route_status='awaiting_kabag'
 ORDER BY d.received_at DESC,i.agenda_no DESC LIMIT 100`

// ---- 154. GET /leadership/directives/letters ----
func (a *API) linkableLetters(w http.ResponseWriter, r *http.Request) {
	actor := actor(r)
	kab, err := a.isKabag(r.Context(), actor)
	if err != nil {
		deny(w, 503)
		return
	}
	if !kab {
		deny(w, 403)
		return
	}
	rows, err := a.DB.Query(r.Context(), linkableLettersSQL, actor)
	if err != nil {
		deny(w, 503)
		return
	}
	defer rows.Close()
	items := make([]linkableLetter, 0)
	for rows.Next() {
		var v linkableLetter
		if rows.Scan(&v.ID, &v.AgendaNo, &v.LetterNumber, &v.Sender, &v.Subject, &v.Classification, &v.Derajat,
			&v.LetterKind, &v.LetterDate, &v.ReceivedAt, &v.DirectiveCount) != nil {
			deny(w, 503)
			return
		}
		items = append(items, v)
	}
	if rows.Err() != nil {
		deny(w, 503)
		return
	}
	respond(w, 200, map[string]any{"items": items})
}
