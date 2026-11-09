package directives

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// A single upload is limited independently; at most five files may accompany
// a directive. Bytes live in private PostgreSQL storage, not a public folder.
const maxDirectiveFileBytes int64 = 100 * 1024 * 1024
const maxDirectiveFiles = 5

type directiveFile struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	MIME      string    `json:"mime"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

func validDirectiveFile(name string, blob []byte) (string, bool) {
	if len(blob) < 6 || int64(len(blob)) > maxDirectiveFileBytes || len(name) == 0 || len(name) > 180 {
		return "", false
	}
	if strings.ContainsAny(name, "/\\\x00\r\n") || name == "." || name == ".." || filepath.Base(name) != name {
		return "", false
	}
	detected := http.DetectContentType(blob)
	ext := strings.ToLower(filepath.Ext(name))
	if ext == ".pdf" && detected == "application/pdf" && bytes.HasPrefix(blob, []byte("%PDF-")) && bytes.Contains(blob[maxInt(0, len(blob)-4096):], []byte("%%EOF")) {
		return "application/pdf", true
	}
	if ((ext == ".jpg" || ext == ".jpeg") && detected == "image/jpeg") || (ext == ".png" && detected == "image/png") {
		cfg, format, err := image.DecodeConfig(bytes.NewReader(blob))
		if err == nil && cfg.Width > 0 && cfg.Height > 0 && int64(cfg.Width)*int64(cfg.Height) <= 40_000_000 {
			if (detected == "image/jpeg" && format == "jpeg") || (detected == "image/png" && format == "png") {
				return detected, true
			}
		}
	}
	return "", false
}
func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func (a *API) listDraftFiles(w http.ResponseWriter, r *http.Request) {
	actorID := actor(r)
	if !a.draftPermission(w, r.Context(), actorID) {
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT id::text,filename,mime_type,size_bytes,created_at FROM sdl_leadership_directive_files WHERE issuer_id=$1::uuid AND directive_id IS NULL ORDER BY created_at,id`, actorID)
	if err != nil {
		deny(w, 503)
		return
	}
	defer rows.Close()
	files := make([]directiveFile, 0)
	for rows.Next() {
		var f directiveFile
		if rows.Scan(&f.ID, &f.Name, &f.MIME, &f.Size, &f.CreatedAt) != nil {
			deny(w, 503)
			return
		}
		files = append(files, f)
	}
	if rows.Err() != nil {
		deny(w, 503)
		return
	}
	respond(w, 200, map[string]any{"items": files, "maxFiles": maxDirectiveFiles, "maxBytesPerFile": maxDirectiveFileBytes})
}

func (a *API) uploadDraftFile(w http.ResponseWriter, r *http.Request) {
	actorID := actor(r)
	if !a.draftPermission(w, r.Context(), actorID) {
		return
	}
	raw := r.Header.Get("X-File-Name")
	name, err := url.QueryUnescape(raw)
	if err != nil || len(raw) > 700 || len(name) > 180 || name == "" {
		deny(w, 400)
		return
	}
	if r.ContentLength > maxDirectiveFileBytes || r.ContentLength < 0 { // Explicit bounded length required; no indefinite streaming.
		deny(w, 413)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxDirectiveFileBytes+1)
	data, err := io.ReadAll(io.LimitReader(r.Body, maxDirectiveFileBytes+1))
	if err != nil || int64(len(data)) > maxDirectiveFileBytes {
		deny(w, 413)
		return
	}
	mime, valid := validDirectiveFile(name, data)
	if !valid {
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
	err = tx.QueryRow(r.Context(), `SELECT revision FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid FOR UPDATE`, actorID).Scan(&rev)
	if errors.Is(err, pgx.ErrNoRows) {
		deny(w, 409)
		return
	}
	if err != nil {
		deny(w, 503)
		return
	}
	var count int
	if tx.QueryRow(r.Context(), `SELECT COUNT(*)::int FROM sdl_leadership_directive_files WHERE issuer_id=$1::uuid AND directive_id IS NULL`, actorID).Scan(&count) != nil {
		deny(w, 503)
		return
	}
	if count >= maxDirectiveFiles {
		deny(w, 409)
		return
	}
	digest := sha256.Sum256(data)
	var id string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_leadership_directive_files(issuer_id,filename,mime_type,size_bytes,sha256,file_data) VALUES($1::uuid,$2,$3,$4,$5,$6) RETURNING id::text`, actorID, name, mime, len(data), hex.EncodeToString(digest[:]), data).Scan(&id)
	if err != nil {
		deny(w, 503)
		return
	}
	if tx.Commit(r.Context()) != nil {
		deny(w, 503)
		return
	}
	respond(w, 201, map[string]string{"id": id})
}

func (a *API) deleteDraftFile(w http.ResponseWriter, r *http.Request) {
	actorID := actor(r)
	if !a.draftPermission(w, r.Context(), actorID) {
		return
	}
	id := chi.URLParam(r, "fileID")
	if !uuid.MatchString(id) {
		deny(w, 404)
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		deny(w, 503)
		return
	}
	defer tx.Rollback(r.Context())
	var rev int64
	err = tx.QueryRow(r.Context(), `SELECT revision FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid FOR UPDATE`, actorID).Scan(&rev)
	if err != nil {
		deny(w, 409)
		return
	}
	tag, err := tx.Exec(r.Context(), `DELETE FROM sdl_leadership_directive_files WHERE id=$1::uuid AND issuer_id=$2::uuid AND directive_id IS NULL`, id, actorID)
	if err != nil {
		deny(w, 503)
		return
	}
	if tag.RowsAffected() == 0 {
		deny(w, 404)
		return
	}
	if tx.Commit(r.Context()) != nil {
		deny(w, 503)
		return
	}
	respond(w, 200, map[string]bool{"deleted": true})
}

func (a *API) canReadSentFile(ctx context.Context, actorID, directiveID string) (bool, error) {
	var allowed bool
	err := a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_leadership_directives d WHERE d.id=$1::uuid AND (EXISTS(SELECT 1 FROM sdl_leadership_directive_recipients rr WHERE rr.directive_id=d.id AND rr.recipient_id=$2::uuid) OR d.issuer_id=$2::uuid))`, directiveID, actorID).Scan(&allowed)
	if err != nil {
		return false, err
	}
	if !allowed {
		return false, nil
	}
	// Issuing users may read their own directives only while still authorized as Kabag;
	// a recipient has independent, explicit access via the recipient relationship.
	var isIssuer bool
	err = a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_leadership_directives WHERE id=$1::uuid AND issuer_id=$2::uuid)`, directiveID, actorID).Scan(&isIssuer)
	if err != nil {
		return false, err
	}
	if isIssuer {
		return a.isKabag(ctx, actorID)
	}
	return true, nil
}
func (a *API) listSentFiles(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !uuid.MatchString(id) {
		deny(w, 404)
		return
	}
	allowed, err := a.canReadSentFile(r.Context(), actor(r), id)
	if err != nil {
		deny(w, 503)
		return
	}
	if !allowed {
		deny(w, 404)
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT id::text,filename,mime_type,size_bytes,created_at FROM sdl_leadership_directive_files WHERE directive_id=$1::uuid ORDER BY created_at,id`, id)
	if err != nil {
		deny(w, 503)
		return
	}
	defer rows.Close()
	files := make([]directiveFile, 0)
	for rows.Next() {
		var f directiveFile
		if rows.Scan(&f.ID, &f.Name, &f.MIME, &f.Size, &f.CreatedAt) != nil {
			deny(w, 503)
			return
		}
		files = append(files, f)
	}
	if rows.Err() != nil {
		deny(w, 503)
		return
	}
	respond(w, 200, map[string]any{"items": files})
}
func (a *API) getDirectiveFile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "fileID")
	if !uuid.MatchString(id) {
		deny(w, 404)
		return
	}
	actorID := actor(r)
	var directiveID *string
	err := a.DB.QueryRow(r.Context(), `SELECT directive_id::text FROM sdl_leadership_directive_files WHERE id=$1::uuid`, id).Scan(&directiveID)
	if errors.Is(err, pgx.ErrNoRows) {
		deny(w, 404)
		return
	}
	if err != nil {
		deny(w, 503)
		return
	}
	if directiveID == nil {
		if !a.draftPermission(w, r.Context(), actorID) {
			return
		}
		var owner bool
		if a.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_leadership_directive_files WHERE id=$1::uuid AND issuer_id=$2::uuid AND directive_id IS NULL)`, id, actorID).Scan(&owner) != nil {
			deny(w, 503)
			return
		}
		if !owner {
			deny(w, 404)
			return
		}
	} else {
		allowed, e := a.canReadSentFile(r.Context(), actorID, *directiveID)
		if e != nil {
			deny(w, 503)
			return
		}
		if !allowed {
			deny(w, 404)
			return
		}
	}
	var name, mime, digest string
	var data []byte
	var size int64
	err = a.DB.QueryRow(r.Context(), `SELECT filename,mime_type,size_bytes,sha256,file_data FROM sdl_leadership_directive_files WHERE id=$1::uuid`, id).Scan(&name, &mime, &size, &digest, &data)
	if err != nil {
		deny(w, 503)
		return
	}
	actual := sha256.Sum256(data)
	if int64(len(data)) != size || hex.EncodeToString(actual[:]) != digest {
		deny(w, 503)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	_, _ = w.Write(data)
}
