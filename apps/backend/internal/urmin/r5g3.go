package urmin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"siera-delta-lima/backend/internal/devdemo"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// R5G3: move a disposition that has fallen outside the active ±30 day window
// into the Urmin archive register.
//
// This endpoint deliberately spans two domains, so it answers to BOTH of their
// gates rather than picking the more convenient one:
//
//   - read     — Engine A must allow 'urmin.surat_masuk.read' on the letter
//     behind the disposition
//   - register — you must independently be allowed to CREATE an Urmin register
//     entry, the same check unitwork.permit() applies to endpoint 44
//
// The first gate is READ ON THE LETTER, deliberately not taskParty(). Archiving
// is Urmin housekeeping over a letter's lifecycle, and disposition parties are
// mostly in subbagren/sumda/binfung — none of which hold a grant in unit
// 'urmin'. Pairing taskParty with the register check would have produced an
// endpoint no real account could reach: 403 for the parties, 404 for the Urmin
// staff who own the archive. That is exactly the B9 failure recorded in
// DEVIATIONS.md, and it is avoided here on purpose rather than by luck.
//
// Nothing is deleted or moved. The disposition row stays exactly where it is;
// archiving only adds a register entry pointing back at it. The disposition
// continues to be reachable through `?window=archive`.

var archiveCodeUnsafe = regexp.MustCompile(`[^A-Za-z0-9]+`)

// Deterministic by construction, and that is what makes archiving idempotent:
// `sdl_urmin_registry_active_code` is UNIQUE(kind, lower(ref_code)) among rows
// that are not soft-deleted, so a second attempt collides instead of creating
// a duplicate. No extra column and no advisory lock needed.
//
// Capped at 64 characters because ref_code is VARCHAR(64); the letter number is
// what gets truncated, never the task-id suffix that makes the code unique.
//
// The suffix is the WHOLE task UUID, not a prefix of it. An earlier version took
// the first 8 characters and that was wrong twice over: UUIDs allocated in a
// block share their leading characters, so two different tasks on the SAME
// letter produced the SAME code — and because this code is the idempotency key,
// the second task would silently answer "already_archived" and never get
// archived at all. A truncated key cannot do the one job it has.
//
// 9 (prefix) + 32 (uuid) + 1 (separator) = 42, leaving 22 characters for the
// letter number.
func archiveRefCode(letterNumber, taskID string) string {
	number := strings.Trim(archiveCodeUnsafe.ReplaceAllString(letterNumber, "-"), "-")
	suffix := strings.ReplaceAll(taskID, "-", "")
	const prefix = "ARS-DISP-"
	room := 64 - len(prefix) - len(suffix) - 1
	if room < 0 {
		room = 0
	}
	if len(number) > room {
		number = strings.Trim(number[:room], "-")
	}
	if number == "" {
		number = "TANPA-NOMOR"
	}
	return strings.ToUpper(prefix + number + "-" + suffix)
}

// Mirrors the `action == "create"` branch of unitwork.permit() for unit
// 'urmin'. Duplicated rather than imported because permit() is an unexported
// method on a different package's API struct; the SQL is copied verbatim so
// the two cannot drift on anything that matters.
func (a *API) archiveRegisterAllowed(ctx context.Context, user, classification string) (bool, error) {
	demo, err := devdemo.Superadmin(ctx, a.DB, user)
	if err != nil || demo {
		return false, err
	}
	var ok bool
	err = a.DB.QueryRow(ctx, `SELECT EXISTS(
   SELECT 1 FROM sdl_access_grants g
     JOIN sdl_roles r ON r.role_key=g.role_key AND r.is_active
     JOIN sdl_user_units uu ON uu.user_id=g.user_id AND uu.unit_key=g.unit_key
     JOIN sdl_users u ON u.id=g.user_id AND u.is_active AND NOT u.must_change_password
    WHERE g.user_id=$1::uuid AND g.unit_key='urmin' AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at>now())
      AND (g.scope='own' OR g.scope='unit')
      AND ($2='biasa' OR g.classification_limit='penting')
      AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin'))`,
		user, classification).Scan(&ok)
	return ok, err
}

func (a *API) archiveDisposition(w http.ResponseWriter, r *http.Request) {
	user := actor(r.Context())
	id := chi.URLParam(r, "taskId")
	if !uuidPattern.MatchString(id) {
		fail(w, 404, "not_found")
		return
	}
	task, err := a.loadTask(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	doc, err := a.load(r.Context(), task.IncomingID)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	// 404, not 403: the same shape endpoint 99 uses, so a caller cannot probe
	// which letters exist by reading the status code.
	readable, err := a.decision(r.Context(), user, "urmin.surat_masuk.read", doc)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !readable {
		fail(w, 404, "not_found")
		return
	}
	allowed, err := a.archiveRegisterAllowed(r.Context(), user, task.Classification)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 403, "access_denied")
		return
	}

	// The window is enforced here, not only in the UI. A client that simply
	// posts to this path must not be able to archive a disposition that is
	// still inside the active range.
	// R5G8: kriterianya status, bukan umur surat. Sebuah disposisi diarsipkan
	// ketika pekerjaannya SELESAI dan sudah disahkan penerbit — bukan ketika
	// suratnya kebetulan sudah tua.
	if task.ReviewStatus != "approved" {
		fail(w, 409, "not_approved")
		return
	}

	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())

	registryID, workID, code, existed, err := a.writeDispositionArchive(r.Context(), tx, user, task)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	// Sudah pernah diarsipkan — lewat telaah yang menyetujuinya, atau lewat
	// penekanan tombol sebelumnya. 409, bukan entri kedua yang diam-diam.
	if existed {
		fail(w, 409, "already_archived")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 201, map[string]any{"id": registryID, "refCode": code, "workRecordId": workID})
}

// Penulis entri arsip, dipakai DUA jalur: telaah yang menyetujui (endpoint 120,
// otomatis) dan tombol Arsipkan (endpoint 143, manual).
//
// Mengembalikan existed=true kalau kodenya sudah ada. Keberadaan itu diperiksa
// LEBIH DULU, bukan diserahkan ke ON CONFLICT, karena baris register selalu
// berpasangan dengan satu berkas kerja: menyisipkan berkas kerjanya dulu lalu
// membiarkan register-nya bentrok akan meninggalkan berkas kerja yatim pada
// transaksi yang tetap di-commit — dan transaksi telaah memang harus tetap
// di-commit walau arsipnya dilewati.
func (a *API) writeDispositionArchive(ctx context.Context, tx pgx.Tx, user string, task dispositionTask) (registryID, workID, code string, existed bool, err error) {
	code = archiveRefCode(task.LetterNumber, task.ID)
	var taken bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_urmin_registry
   WHERE kind='arsip' AND lower(ref_code)=lower($1) AND deleted_at IS NULL)`, code).Scan(&taken); err != nil {
		return "", "", code, false, err
	}
	if taken {
		return "", "", code, true, nil
	}

	var letterDate string
	if err = tx.QueryRow(ctx, `SELECT i.letter_date::text FROM sdl_urmin_incoming i WHERE i.id=$1`, task.IncomingID).Scan(&letterDate); err != nil {
		return "", "", code, false, err
	}

	title := "Arsip disposisi " + task.LetterNumber
	if task.Subject != "" {
		title = "Arsip disposisi " + task.LetterNumber + " - " + task.Subject
	}
	if len([]rune(title)) > 200 {
		title = string([]rune(title)[:200])
	}
	fields, _ := json.Marshal(map[string]string{
		"sumber":        "disposisi",
		"dispositionId": task.ID,
		"incomingId":    task.IncomingID,
		"letterNumber":  task.LetterNumber,
		"letterDate":    letterDate,
		"unit":          task.Unit,
	})

	// Bentuk dua baris yang sama dengan endpoint 44: tiap entri register
	// memiliki tepat satu berkas kerja (work_record_id NOT NULL UNIQUE).
	if err = tx.QueryRow(ctx, `INSERT INTO sdl_unit_work_records(unit_key,category,title,description,classification,created_by,updated_by)
   VALUES('urmin','Register Urmin arsip',$1,'',$2,$3::uuid,$3::uuid) RETURNING id::text`,
		title, task.Classification, user).Scan(&workID); err != nil {
		return "", "", code, false, err
	}
	if err = tx.QueryRow(ctx, `INSERT INTO sdl_urmin_registry(kind,ref_code,title,fields,work_record_id,created_by,updated_by)
   VALUES('arsip',$1,$2,$3::jsonb,$4::uuid,$5::uuid,$5::uuid) RETURNING id::text`,
		code, title, string(fields), workID, user).Scan(&registryID); err != nil {
		return "", "", code, false, err
	}
	if err = audit(ctx, tx, user, "urmin.disposisi.archived", task.ID); err != nil {
		return "", "", code, false, err
	}
	return registryID, workID, code, false, nil
}
