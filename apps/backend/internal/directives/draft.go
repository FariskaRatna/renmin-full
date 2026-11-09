package directives

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// A single private draft belongs to the authenticated Kabagrenmin account.
// Revisions prevent stale autosave tabs from silently overwriting newer drafts.
type directiveDraft struct {
	Title      string   `json:"title"`
	Body       string   `json:"body"`
	Kind       string   `json:"kind"`
	Priority   string   `json:"priority"`
	DueAt      string   `json:"dueAt"`
	Recipients []string `json:"recipients"`
	// R5H1. Alasan yang sama dengan Recipients di atasnya: selalu hadir, array
	// kosong saat belum ada bagian yang dipilih. Draf adalah kertas buram, jadi
	// kombinasi 'sections' DAN 'recipients' terisi bersamaan diterima di sini
	// walau ditolak saat kirim -- autosave tidak boleh mulai gagal saat penulis
	// sedang berpindah pikiran dari satu cara menunjuk ke cara yang lain.
	Sections []string `json:"sections"`
	// R5G2. No omitempty, unlike the summary struct: every other draft field is
	// always present too, and an autosaving client needs to tell "no letter
	// chosen" apart from "this build does not know the field".
	IncomingID *string `json:"incomingId"`
	// R5H2. omitempty, BERBEDA dengan IncomingID di atas: draf yang tersimpan
	// sebelum 041 dan draf tanpa lembar harus tetap dibaca byte-identik.
	Sheet *sheet `json:"sheet,omitempty"`
}

type draftSave struct {
	directiveDraft
	Revision int64 `json:"revision"`
}

var localDateTimePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$`)

func validDraft(d directiveDraft) bool {
	if !utf8.ValidString(d.Title) || utf8.RuneCountInString(d.Title) > 160 || !utf8.ValidString(d.Body) || utf8.RuneCountInString(d.Body) > 4000 {
		return false
	}
	switch d.Kind {
	case "umum", "persuratan", "sprint", "lainnya":
	default:
		return false
	}
	switch d.Priority {
	case "biasa", "penting", "kilat":
	default:
		return false
	}
	if len(d.Recipients) > 10 {
		return false
	}
	seen := make(map[string]bool, len(d.Recipients))
	for _, id := range d.Recipients {
		if !uuid.MatchString(id) || seen[strings.ToLower(id)] {
			return false
		}
		seen[strings.ToLower(id)] = true
	}
	// Bentuk saja, sama seperti recipients di atas: kunci harus dikenal dan
	// tidak berulang. Apakah bagiannya masih punya pemegang jabatan adalah
	// pertanyaan database, dijawab saat kirim.
	if len(d.Sections) > len(sections) {
		return false
	}
	chosen := make(map[string]bool, len(d.Sections))
	for _, key := range d.Sections {
		if _, ok := sectionByKey(key); !ok || chosen[key] {
			return false
		}
		chosen[key] = true
	}
	if d.DueAt != "" {
		if !localDateTimePattern.MatchString(d.DueAt) {
			return false
		}
		t, err := time.Parse("2006-01-02T15:04", d.DueAt)
		if err != nil || t.Format("2006-01-02T15:04") != d.DueAt {
			return false
		}
	}
	// Shape only, deliberately NOT letterLinkAllowed. A draft is private scratch
	// that is never delivered, and autosave must not start failing while the
	// author is still deciding. The real gate runs at send.
	if d.IncomingID != nil && !uuid.MatchString(*d.IncomingID) {
		return false
	}
	return validSheet(d.Sheet)
}

func (a *API) draftPermission(w http.ResponseWriter, ctx context.Context, who string) bool {
	yes, err := a.isKabag(ctx, who)
	if err != nil {
		deny(w, 503)
		return false
	}
	if !yes {
		deny(w, 403)
		return false
	}
	return true
}

func (a *API) getDraft(w http.ResponseWriter, r *http.Request) {
	who := actor(r)
	if !a.draftPermission(w, r.Context(), who) {
		return
	}
	var d directiveDraft
	var recipients, sectionKeys, rawSheet []byte
	var rev int64
	var updated time.Time
	err := a.DB.QueryRow(r.Context(), `SELECT title,body,kind,priority,due_at_local,recipient_ids,section_keys,incoming_id::text,sheet,revision,updated_at FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid`, who).Scan(&d.Title, &d.Body, &d.Kind, &d.Priority, &d.DueAt, &recipients, &sectionKeys, &d.IncomingID, &rawSheet, &rev, &updated)
	if errors.Is(err, pgx.ErrNoRows) {
		respond(w, 200, map[string]any{"draft": nil})
		return
	}
	if err != nil || json.Unmarshal(recipients, &d.Recipients) != nil || json.Unmarshal(sectionKeys, &d.Sections) != nil {
		deny(w, 503)
		return
	}
	if d.Sheet, err = decodeSheet(rawSheet); err != nil {
		deny(w, 503)
		return
	}
	respond(w, 200, map[string]any{"draft": d, "revision": rev, "updatedAt": updated})
}

func (a *API) putDraft(w http.ResponseWriter, r *http.Request) {
	who := actor(r)
	if !a.draftPermission(w, r.Context(), who) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 14000)
	var p draftSave
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if dec.Decode(&p) != nil || dec.Decode(new(any)) != io.EOF || p.Revision < 0 || !validDraft(p.directiveDraft) {
		deny(w, 400)
		return
	}
	if p.Recipients == nil {
		p.Recipients = []string{}
	}
	if p.Sections == nil {
		p.Sections = []string{}
	}
	recipients, err := json.Marshal(p.Recipients)
	if err != nil {
		deny(w, 400)
		return
	}
	sectionKeys, err := json.Marshal(p.Sections)
	if err != nil {
		deny(w, 400)
		return
	}
	// Draf menyimpan lembar apa adanya (setelah normalisasi), tanpa memeriksa
	// master disposisi: kertas buram tidak boleh mulai gagal disimpan hanya
	// karena Superadmin menghapus satu opsi. Gerbangnya ada saat kirim.
	sheetValue, err := sheetArg(normalizeSheet(p.Sheet))
	if err != nil {
		deny(w, 400)
		return
	}
	var revision int64
	var updated time.Time
	// Revision zero inserts the first draft; later writes compare-and-swap.
	err = a.DB.QueryRow(r.Context(), `INSERT INTO sdl_leadership_directive_drafts AS d(issuer_id,title,body,kind,priority,due_at_local,recipient_ids,section_keys,incoming_id,sheet,revision,updated_at)
       VALUES($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::uuid,$11::jsonb,1,NOW())
       ON CONFLICT(issuer_id) DO UPDATE SET title=EXCLUDED.title,body=EXCLUDED.body,kind=EXCLUDED.kind,priority=EXCLUDED.priority,due_at_local=EXCLUDED.due_at_local,recipient_ids=EXCLUDED.recipient_ids,section_keys=EXCLUDED.section_keys,incoming_id=EXCLUDED.incoming_id,sheet=EXCLUDED.sheet,revision=d.revision+1,updated_at=NOW()
       WHERE d.revision=$10 RETURNING revision,updated_at`, who, p.Title, p.Body, p.Kind, p.Priority, p.DueAt, recipients, sectionKeys, p.IncomingID, p.Revision, sheetValue).Scan(&revision, &updated)
	if errors.Is(err, pgx.ErrNoRows) {
		respond(w, 409, map[string]string{"error": "draft_conflict"})
		return
	}
	if err != nil {
		deny(w, 503)
		return
	}
	respond(w, 200, map[string]any{"revision": revision, "updatedAt": updated})
}

func (a *API) deleteDraft(w http.ResponseWriter, r *http.Request) {
	who := actor(r)
	if !a.draftPermission(w, r.Context(), who) {
		return
	}
	var p struct {
		Revision int64 `json:"revision"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 512)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if dec.Decode(&p) != nil || dec.Decode(new(any)) != io.EOF || p.Revision < 0 {
		deny(w, 400)
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		deny(w, 503)
		return
	}
	defer tx.Rollback(r.Context())
	var rev int64
	err = tx.QueryRow(r.Context(), `SELECT revision FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid FOR UPDATE`, who).Scan(&rev)
	if errors.Is(err, pgx.ErrNoRows) || rev != p.Revision {
		respond(w, 409, map[string]string{"error": "draft_conflict"})
		return
	}
	if err != nil {
		deny(w, 503)
		return
	}
	if _, err = tx.Exec(r.Context(), `DELETE FROM sdl_leadership_directive_files WHERE issuer_id=$1::uuid AND directive_id IS NULL`, who); err != nil {
		deny(w, 503)
		return
	}
	tag, err := tx.Exec(r.Context(), `DELETE FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid AND revision=$2`, who, p.Revision)
	if err != nil {
		deny(w, 503)
		return
	}
	if tag.RowsAffected() != 1 {
		respond(w, 409, map[string]string{"error": "draft_conflict"})
		return
	}
	if tx.Commit(r.Context()) != nil {
		deny(w, 503)
		return
	}
	respond(w, 200, map[string]bool{"deleted": true})
}
