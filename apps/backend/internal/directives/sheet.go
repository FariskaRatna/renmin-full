package directives

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// R5H2: lembar disposisi yang menempel pada arahan (migrasi 041).
//
// Seluruh isiannya opsional dan dikirim sebagai SATU objek `sheet`. Klien lama
// yang tidak mengenal field ini tidak mengirimnya, dan arahan tanpa lembar
// diserialisasi persis seperti sebelum 041 (omitempty di summary dan draft).
//
// Padanan Express: apps/backend-express/src/modules/directives/sheet.js.
// Urutan field di struct ini adalah urutan kunci di respons JSON -- sheet.js
// wajib menyusun objeknya dengan urutan yang sama.
type sheet struct {
	LetterFrom      string   `json:"letterFrom"`
	LetterNumber    string   `json:"letterNumber"`
	DirectiveDate   string   `json:"directiveDate"`
	LetterDate      string   `json:"letterDate"`
	Subject         string   `json:"subject"`
	Classification  string   `json:"classification"`
	Derajat         string   `json:"derajat"`
	Dispositions    []string `json:"dispositions"`
	DispositionNote string   `json:"dispositionNote"`
	// Milik server. Akan diisi saat bagian yang ditunjuk membuat surat dari
	// arahan ini (tahap berikutnya); sampai saat itu selalu null. Permintaan
	// yang mengisinya ditolak -- pemanggil tidak boleh menentukan nomor agenda.
	AgendaNo *int64 `json:"agendaNo"`
}

var (
	dispositionCodePattern = regexp.MustCompile(`^[A-Z][A-Z0-9_]{1,23}$`)
	isoDatePattern         = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

const maxDispositions = 20

func validDate(s string) bool {
	if s == "" {
		return true
	}
	if !isoDatePattern.MatchString(s) {
		return false
	}
	t, err := time.Parse("2006-01-02", s)
	return err == nil && t.Format("2006-01-02") == s
}

func shortText(s string, max int) bool {
	return utf8.ValidString(s) && utf8.RuneCountInString(s) <= max
}

// Bentuk saja, dipakai oleh draft maupun kirim. Pertanyaan yang butuh database
// -- apakah kode disposisinya ada, apakah penerimanya boleh menerima arahan
// rahasia -- dijawab sheetAllowed di dalam transaksi kirim.
func validSheet(s *sheet) bool {
	if s == nil {
		return true
	}
	if s.AgendaNo != nil {
		return false
	}
	if !shortText(s.LetterFrom, 200) || !shortText(s.LetterNumber, 100) || !shortText(s.Subject, 250) || !shortText(s.DispositionNote, 1000) {
		return false
	}
	if !validDate(s.DirectiveDate) || !validDate(s.LetterDate) {
		return false
	}
	switch s.Classification {
	case "biasa", "penting":
	default:
		return false
	}
	switch s.Derajat {
	case "biasa", "kilat":
	default:
		return false
	}
	if len(s.Dispositions) > maxDispositions {
		return false
	}
	seen := make(map[string]bool, len(s.Dispositions))
	for _, code := range s.Dispositions {
		if !dispositionCodePattern.MatchString(code) || seen[code] {
			return false
		}
		seen[code] = true
	}
	return true
}

// Normalisasi sebelum disimpan: teks di-trim dan daftar disposisi tidak pernah
// null, supaya pembacaan ulang selalu menghasilkan bentuk yang sama.
func normalizeSheet(s *sheet) *sheet {
	if s == nil {
		return nil
	}
	v := *s
	v.LetterFrom = strings.TrimSpace(v.LetterFrom)
	v.LetterNumber = strings.TrimSpace(v.LetterNumber)
	v.Subject = strings.TrimSpace(v.Subject)
	v.DispositionNote = strings.TrimSpace(v.DispositionNote)
	if v.Dispositions == nil {
		v.Dispositions = []string{}
	}
	v.AgendaNo = nil
	return &v
}

// Nilai untuk parameter JSONB: nil menjadi SQL NULL.
func sheetArg(s *sheet) (any, error) {
	if s == nil {
		return nil, nil
	}
	b, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

// Kebalikan sheetArg, untuk kolom JSONB yang dibaca sebagai []byte.
func decodeSheet(raw []byte) (*sheet, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var s sheet
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	if s.Dispositions == nil {
		s.Dispositions = []string{}
	}
	return &s, nil
}

// Gerbang lembar disposisi saat kirim. false berarti 400: payload menyebut
// sesuatu yang tidak sah, sama seperti penerima atau surat yang tidak sah.
func sheetAllowed(ctx context.Context, tx pgx.Tx, s *sheet, incoming *string, _ []resolved) (bool, error) {
	if s == nil {
		return true, nil
	}
	if len(s.Dispositions) > 0 {
		var known int
		if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM sdl_disposisi_opsi WHERE code=ANY($1::text[])`, s.Dispositions).Scan(&known); err != nil {
			return false, err
		}
		if known != len(s.Dispositions) {
			return false, nil
		}
	}
	// Lembar tidak boleh menurunkan klasifikasi surat yang ditautkan: surat
	// Rahasia yang diberi lembar 'biasa' akan tampil sebagai dokumen biasa di
	// detail arahan.
	if incoming != nil && s.Classification != "penting" {
		var letterClass string
		if err := tx.QueryRow(ctx, `SELECT classification FROM sdl_urmin_incoming WHERE id=$1::uuid`, *incoming).Scan(&letterClass); err != nil {
			return false, err
		}
		if letterClass == "penting" {
			return false, nil
		}
	}
	// R5H4: lembar 'penting' TIDAK lagi menuntut setiap penerima memegang
	// grant ber-classification_limit 'penting'. Keputusan pemilik sistem
	// (2026-11-04): klasifikasi tidak membatasi siapa menerima arahan. Yang
	// tetap dijaga adalah naskah surat yang tertaut -- ia hanya diserahkan
	// kepada anggota yang berhak (handOverLetter), dan modul Urmin memeriksa
	// ulang klasifikasinya setiap kali surat dibuka.
	return true, nil
}

// Opsi disposisi: kode -> nama. Dipakai layar penyusun (Kabagrenmin) DAN layar
// detail penerima, yang hanya menyimpan kode di lembar dan perlu namanya untuk
// ditampilkan. Karena itu tanpa gerbang isKabag: isinya label referensi yang
// sama untuk semua orang, dan router sudah menuntut AuthorizeOperational.
// Pengelolaannya lewat Master Data (Superadmin).
func (a *API) dispositionOptions(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `SELECT code,name FROM sdl_disposisi_opsi ORDER BY name`)
	if err != nil {
		deny(w, 503)
		return
	}
	defer rows.Close()
	type option struct {
		Code string `json:"code"`
		Name string `json:"name"`
	}
	items := make([]option, 0)
	for rows.Next() {
		var v option
		if rows.Scan(&v.Code, &v.Name) != nil {
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
