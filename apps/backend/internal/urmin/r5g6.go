package urmin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"siera-delta-lima/backend/internal/unitwork"
)

// R5G6: bukti hasil tindak lanjut pada tugas disposisi.
//
// Sampai sekarang "Selesaikan Tugas" hanya menerima catatan teks. Berkas
// hasilnya — foto kegiatan, surat balasan, laporan — tidak punya tempat, jadi
// pelaksana mengirimnya di luar sistem dan penerbit menelaah tanpa melihat apa
// yang sebenarnya dikerjakan.
//
// Tiga endpoint, dan gerbangnya TIDAK sama:
//
//   - unggah  : hanya PELAKSANA, dan hanya selama tugasnya belum selesai
//   - daftar  : seluruh pihak tugas (pelaksana dan penerbit)
//   - unduh   : seluruh pihak tugas
//
// Pembedaan itu yang menjadikannya bukti. Kalau penerbit boleh mengunggah,
// berkas di sini berhenti berarti "ini yang dikerjakan pelaksana"; kalau
// pelaksana masih boleh mengunggah setelah selesai, telaah penerbit dilakukan
// atas kumpulan berkas yang masih bisa berubah di belakangnya.

const maxDispositionFiles = 10

// Pihak tugas, dipakai ketiga endpoint. 404 dan bukan 403 saat bukan pihak:
// bentuk yang sama dengan endpoint 117, supaya keberadaan sebuah tugas tidak
// bisa diselidiki lewat kode status.
// archiveReader (R5H5): bukan pihak tugas, tetapi boleh membaca entri arsip
// disposisinya di register Urmin. Hanya untuk tugas yang SUDAH disetujui —
// entri arsip otomatis memang hanya lahir dari persetujuan — dan izin bacanya
// diputuskan Engine B atas berkas kerja entri arsip itu, persis seperti saat
// membuka entrinya di menu Arsip.
func (a *API) archiveReader(ctx context.Context, actorID, taskID string) (bool, error) {
	rows, err := a.DB.Query(ctx, `SELECT w.classification,w.created_by::text,w.id::text
		FROM sdl_urmin_registry s JOIN sdl_unit_work_records w ON w.id=s.work_record_id
		WHERE s.kind='arsip' AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.unit_key='urmin'
		  AND s.fields->>'sumber'='disposisi' AND s.fields->>'dispositionId'=$1
		  AND EXISTS(SELECT 1 FROM sdl_urmin_disposition_reviews rv WHERE rv.disposition_id::text=$1 AND rv.decision='approved')`, taskID)
	if err != nil {
		return false, err
	}
	type entry struct{ class, owner, record string }
	var entries []entry
	for rows.Next() {
		var e entry
		if err = rows.Scan(&e.class, &e.owner, &e.record); err != nil {
			rows.Close()
			return false, err
		}
		entries = append(entries, e)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return false, err
	}
	for _, e := range entries {
		ok, err := unitwork.PermitRead(ctx, a.DB, actorID, "urmin", e.class, e.owner, e.record)
		if err != nil || ok {
			return ok, err
		}
	}
	return false, nil
}

func (a *API) dispositionFileParty(w http.ResponseWriter, r *http.Request) (dispositionTask, bool) {
	return a.dispositionFileAccess(w, r, false)
}

// dispositionFileAccess: readOnly=true juga menerima pembaca arsip (R5H5).
// Unggah tetap lewat dispositionFileParty, jadi hanya pihak tugas.
func (a *API) dispositionFileAccess(w http.ResponseWriter, r *http.Request, readOnly bool) (dispositionTask, bool) {
	id := chi.URLParam(r, "taskId")
	if !uuidPattern.MatchString(id) {
		fail(w, 404, "not_found")
		return dispositionTask{}, false
	}
	task, err := a.loadTask(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return dispositionTask{}, false
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return dispositionTask{}, false
	}
	party, err := a.taskParty(r.Context(), actor(r.Context()), task)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return dispositionTask{}, false
	}
	if !party && readOnly {
		party, err = a.archiveReader(r.Context(), actor(r.Context()), task.ID)
		if err != nil {
			fail(w, 503, "authorization_unavailable")
			return dispositionTask{}, false
		}
	}
	if !party {
		fail(w, 404, "not_found")
		return dispositionTask{}, false
	}
	return task, true
}

type dispositionFile struct {
	ID         string    `json:"id"`
	Filename   string    `json:"filename"`
	MimeType   string    `json:"mimeType"`
	SizeBytes  int       `json:"sizeBytes"`
	SHA256     string    `json:"sha256"`
	UploadedBy string    `json:"uploadedBy"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (a *API) uploadDispositionFile(w http.ResponseWriter, r *http.Request) {
	task, ok := a.dispositionFileParty(w, r)
	if !ok {
		return
	}
	user := actor(r.Context())
	// Penerbit adalah pihak, jadi ia lolos dispositionFileParty — tapi bukan ia
	// yang mengerjakan tugasnya. 403, bukan 404: keberadaan tugasnya memang
	// sudah boleh ia ketahui.
	if user != task.AssigneeID {
		fail(w, 403, "access_denied")
		return
	}
	if task.Status == "completed" {
		fail(w, 409, "already_completed")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAttachmentSize+65536)
	if err := r.ParseMultipartForm(maxAttachmentSize + 65536); err != nil {
		fail(w, 413, "invalid_attachment")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, head, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, "file_required")
		return
	}
	defer file.Close()
	blob, err := io.ReadAll(io.LimitReader(file, maxAttachmentSize+1))
	if err != nil || len(blob) > maxAttachmentSize {
		fail(w, 413, "file_too_large")
		return
	}
	media, valid := validateFile(head.Filename, blob)
	if !valid {
		fail(w, 400, "invalid_file_type")
		return
	}
	reason := strings.TrimSpace(r.FormValue("reason"))
	if !validReason(reason) {
		fail(w, 400, "invalid_reason")
		return
	}

	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())

	// Tugas dikunci dan statusnya dinilai ULANG: tugas bisa saja sudah
	// diselesaikan selama berkasnya dibaca dari jaringan, dan bukti yang
	// menyelinap sesudah telaah dimulai adalah persis yang dicegah di sini.
	var status string
	var assignee string
	err = tx.QueryRow(r.Context(), `SELECT status,assigned_to::text FROM sdl_urmin_disposition_tasks WHERE id=$1 FOR UPDATE`, task.ID).Scan(&status, &assignee)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if assignee != user {
		fail(w, 403, "access_denied")
		return
	}
	if status == "completed" {
		fail(w, 409, "already_completed")
		return
	}

	var count int
	if err = tx.QueryRow(r.Context(), `SELECT count(*)::int FROM sdl_urmin_disposition_files WHERE disposition_id=$1`, task.ID).Scan(&count); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if count >= maxDispositionFiles {
		fail(w, 409, "attachment_limit")
		return
	}

	digest := sha256.Sum256(blob)
	var id string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_urmin_disposition_files(disposition_id,uploaded_by,filename,mime_type,size_bytes,sha256,body)
 VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`,
		task.ID, user, head.Filename, media, len(blob), hex.EncodeToString(digest[:]), blob).Scan(&id)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
 VALUES($1,'urmin.disposisi.file_uploaded','urmin.disposisi.file',$2,jsonb_build_object('disposition_id',$3::text,'reason',$4::text))`,
		user, id, task.ID, reason); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 201, map[string]any{"id": id})
}

func (a *API) listDispositionFiles(w http.ResponseWriter, r *http.Request) {
	task, ok := a.dispositionFileAccess(w, r, true)
	if !ok {
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT f.id::text,f.filename,f.mime_type,f.size_bytes,f.sha256,u.display_name,f.created_at
 FROM sdl_urmin_disposition_files f JOIN sdl_users u ON u.id=f.uploaded_by
 WHERE f.disposition_id=$1 ORDER BY f.created_at,f.id LIMIT 50`, task.ID)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	items := make([]dispositionFile, 0)
	for rows.Next() {
		var v dispositionFile
		if rows.Scan(&v.ID, &v.Filename, &v.MimeType, &v.SizeBytes, &v.SHA256, &v.UploadedBy, &v.CreatedAt) != nil {
			fail(w, 503, "unavailable")
			return
		}
		items = append(items, v)
	}
	if rows.Err() != nil {
		fail(w, 503, "unavailable")
		return
	}
	// canUpload menjawab pertanyaan UI secara langsung, sehingga tombol unggah
	// tidak perlu menebak-nebak dari status dan identitas sendiri.
	jsonResponse(w, 200, map[string]any{
		"items":     items,
		"canUpload": actor(r.Context()) == task.AssigneeID && task.Status != "completed",
	})
}

func (a *API) downloadDispositionFile(w http.ResponseWriter, r *http.Request) {
	task, ok := a.dispositionFileAccess(w, r, true)
	if !ok {
		return
	}
	fileID := chi.URLParam(r, "fileId")
	if !uuidPattern.MatchString(fileID) {
		fail(w, 404, "not_found")
		return
	}
	var filename, media, digest string
	var blob []byte
	err := a.DB.QueryRow(r.Context(), `SELECT filename,mime_type,body,sha256 FROM sdl_urmin_disposition_files WHERE id=$1 AND disposition_id=$2`, fileID, task.ID).
		Scan(&filename, &media, &blob, &digest)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	// Integritas diperiksa sebelum satu byte pun dikirim.
	actual := sha256.Sum256(blob)
	if hex.EncodeToString(actual[:]) != digest {
		fail(w, 503, "attachment_integrity_failure")
		return
	}
	if _, err = a.DB.Exec(r.Context(), `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
 VALUES($1,'urmin.disposisi.file_downloaded','urmin.disposisi.file',$2,jsonb_build_object('disposition_id',$3::text))`,
		actor(r.Context()), fileID, task.ID); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	// Content-Type SELALU octet-stream, apa pun mime_type yang tersimpan —
	// berkas ini tidak pernah dirender peramban.
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", fmt.Sprint(len(blob)))
	_, _ = w.Write(blob)
}
