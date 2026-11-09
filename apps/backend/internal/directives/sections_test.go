package directives

import (
	"testing"
	"time"
)

// Sebelas pilihan dalam tiga jenis. role_key jabatan adalah hal yang paling
// mudah salah ketik: salah satu huruf membuat pilihan itu tidak pernah punya
// anggota, dan gejalanya di layar terbaca seperti data yang belum di-seed.
// Kunci Paur wajib sama dengan baris sdl_paur di migrasi 043.
func TestSectionTableMatchesSeededRoles(t *testing.T) {
	want := map[string][3]string{
		"kasubbagren":     {kindJabatan, "subbagren", "br_kasubbagren"},
		"kasubbagsumda":   {kindJabatan, "subbagsumda", "br_kasubbagsumda"},
		"kasubbagbinfung": {kindJabatan, "subbagbinfung", "br_kasubbagbinfung"},
		// Kepala Urmin. Seed menamainya br_ka_urmin, BUKAN br_kasubbagurmin.
		"kasubbagurmin": {kindJabatan, "urmin", "br_ka_urmin"},
		"subbagren":     {kindBagian, "subbagren", ""},
		"subbagsumda":   {kindBagian, "subbagsumda", ""},
		"subbagbinfung": {kindBagian, "subbagbinfung", ""},
		"urmin":         {kindBagian, "urmin", ""},
		"paur_sumda":    {kindPaur, "subbagsumda", "paur_sumda"},
		"paur_log":      {kindPaur, "subbagsumda", "paur_log"},
		"paur_ada":      {kindPaur, "subbagsumda", "paur_ada"},
	}
	if len(sections) != len(want) {
		t.Fatalf("expected %d sections; found %d", len(want), len(sections))
	}
	for _, s := range sections {
		w, ok := want[s.Key]
		if !ok {
			t.Fatalf("unexpected section %q", s.Key)
		}
		if s.Kind != w[0] || s.Unit != w[1] || s.Role != w[2] {
			t.Fatalf("section %q: expected (%s,%s,%s); found (%s,%s,%s)", s.Key, w[0], w[1], w[2], s.Kind, s.Unit, s.Role)
		}
		if s.Label == "" {
			t.Fatalf("section %q has no label", s.Key)
		}
		if found, ok := sectionByKey(s.Key); !ok || found.Role != s.Role {
			t.Fatalf("sectionByKey(%q) did not round-trip", s.Key)
		}
	}
	if _, ok := sectionByKey("kabagrenmin"); ok {
		t.Fatal("kabagrenmin is not a destination; it is the issuer")
	}
}

func TestUniqueSections(t *testing.T) {
	all := make([]string, 0, len(sections))
	for _, s := range sections {
		all = append(all, s.Key)
	}
	for _, bad := range [][]string{
		nil,
		{},
		{"kasubbagren", "kasubbagren"},
		{"kabagrenmin"},
		{"KASUBBAGREN"},
		{"paur_sarpras"},
		append(append([]string{}, all...), "kasubbagren"),
	} {
		if uniqueSections(bad) {
			t.Fatalf("invalid section list accepted: %v", bad)
		}
	}
	if !uniqueSections([]string{"kasubbagren"}) {
		t.Fatal("single valid section rejected")
	}
	// Jabatan dan bagian yang sama boleh dipilih bersamaan; orang yang
	// terjaring dua kali disaring di resolveSections, bukan ditolak di sini.
	if !uniqueSections([]string{"kasubbagren", "subbagren", "paur_log"}) {
		t.Fatal("mixed kinds rejected")
	}
	if !uniqueSections(all) {
		t.Fatal("all sections rejected")
	}
}

// Dua cara menunjuk penerima, dan tepat satu yang boleh dipakai per
// pengiriman. Payload yang mengisi keduanya ditolak -- bukan digabung.
func TestValidateTargetsAreMutuallyExclusive(t *testing.T) {
	base := createRequest{Title: "Penyiapan surat tugas", Body: "Siapkan dokumen penugasan sesuai arahan rapat.", Kind: "persuratan", Priority: "penting"}
	id := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

	bySection := base
	bySection.Sections = []string{"kasubbagren"}
	if !validate(bySection, time.Now()) {
		t.Fatal("section-only payload rejected")
	}

	byPerson := base
	byPerson.Recipients = []string{id}
	if !validate(byPerson, time.Now()) {
		t.Fatal("legacy recipient-only payload rejected")
	}

	both := base
	both.Sections = []string{"kasubbagren"}
	both.Recipients = []string{id}
	if validate(both, time.Now()) {
		t.Fatal("payload naming BOTH a section and a person accepted")
	}

	neither := base
	if validate(neither, time.Now()) {
		t.Fatal("payload with no destination accepted")
	}

	unknown := base
	unknown.Sections = []string{"kasubbagsarpras"}
	if validate(unknown, time.Now()) {
		t.Fatal("unknown section accepted")
	}
}

// Draf adalah kertas buram: nol bagian sah, dan 'sections' bersama
// 'recipients' pun sah di sini walau ditolak saat kirim. Autosave tidak boleh
// mulai gagal saat penulisnya berpindah dari satu cara menunjuk ke cara lain.
func TestValidDraftAcceptsPartialSectionChoice(t *testing.T) {
	d := directiveDraft{Kind: "umum", Priority: "biasa"}
	if !validDraft(d) {
		t.Fatal("empty draft rejected")
	}
	d.Sections = []string{}
	if !validDraft(d) {
		t.Fatal("draft with zero sections rejected")
	}
	d.Sections = []string{"kasubbagsumda"}
	d.Recipients = []string{"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
	if !validDraft(d) {
		t.Fatal("draft mixing both ways of choosing rejected; the gate belongs at send")
	}
	d.Recipients = nil
	d.Sections = []string{"kasubbagsumda", "kasubbagsumda"}
	if validDraft(d) {
		t.Fatal("duplicate section accepted in draft")
	}
	d.Sections = []string{"paur_sumda_1"}
	if validDraft(d) {
		t.Fatal("unknown section accepted in draft")
	}
}

// CHECK length(btrim(reason)) BETWEEN 8 AND 500 pada sdl_urmin_distributions.
// Judul terpendek yang lolos validasi adalah 3 karakter; judul terpanjang 160.
func TestHandOverReasonFitsColumnCheck(t *testing.T) {
	for _, title := range []string{"ABC", string(make([]byte, 0)), stringOfLen(160)} {
		reason := handOverReason(title)
		if len(reason) < 8 || len(reason) > 500 {
			t.Fatalf("reason length %d outside 8..500 for title of length %d", len(reason), len(title))
		}
	}
}

func stringOfLen(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = 'x'
	}
	return string(b)
}
