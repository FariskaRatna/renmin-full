package subbagren

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// R4A3B: private DB-backed immutable files, maximum 5 MiB per realization.
// Auth is checked for each request, including every download. No public URLs.
const maxEvidenceBytes = 5 << 20

var safeEvidenceName = regexp.MustCompile(`^[a-zA-Z0-9 _().-]{1,160}$`)

type Evidence struct {
	ID           string    `json:"id"`
	RealisasiID  string    `json:"realisasiId"`
	Filename     string    `json:"filename"`
	MIME         string    `json:"mime"`
	Size         int       `json:"size"`
	SHA256       string    `json:"sha256"`
	Status       string    `json:"status"`
	UploadedBy   string    `json:"uploadedBy"`
	ReviewerID   *string   `json:"reviewerId"`
	ReviewReason *string   `json:"reviewReason"`
	Version      int64     `json:"version"`
	CreatedAt    time.Time `json:"createdAt"`
}

func validateEvidence(filename string, blob []byte) (string, bool) {
	filename = strings.TrimSpace(filename)
	if !safeEvidenceName.MatchString(filename) || len(blob) == 0 || len(blob) > maxEvidenceBytes {
		return "", false
	}
	lower := strings.ToLower(filename)
	typ := http.DetectContentType(blob)
	if strings.HasSuffix(lower, ".pdf") && typ == "application/pdf" && bytes.HasPrefix(blob, []byte("%PDF-")) && bytes.Contains(blob[max(0, len(blob)-2048):], []byte("%%EOF")) {
		return "application/pdf", true
	}
	if strings.HasSuffix(lower, ".png") && typ == "image/png" || (strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg")) && typ == "image/jpeg" {
		cfg, format, err := image.DecodeConfig(bytes.NewReader(blob))
		if err == nil && cfg.Width > 0 && cfg.Height > 0 && int64(cfg.Width)*int64(cfg.Height) <= 20000000 && ((typ == "image/png" && format == "png") || (typ == "image/jpeg" && format == "jpeg")) {
			return typ, true
		}
	}
	return "", false
}
func (a *API) evidenceParent(ctx context.Context, id string) (Realisasi, Proposal, error) {
	item, err := scanRealisasi(a.DB.QueryRow(ctx, realisasiCols+` WHERE t.id::text=$1`, id))
	if err != nil {
		return item, Proposal{}, err
	}
	var proposalID string
	err = a.DB.QueryRow(ctx, `SELECT proposal_id::text FROM sdl_subbagren_pagu WHERE id=$1`, item.PaguID).Scan(&proposalID)
	if err != nil {
		return item, Proposal{}, err
	}
	proposal, err := a.budgetProposal(ctx, proposalID)
	return item, proposal, err
}

// Protect both finance record and file identity from enumeration.
func (a *API) evidenceAuth(w http.ResponseWriter, ctx context.Context, user, permission, realID string) (Realisasi, bool) {
	item, proposal, err := a.evidenceParent(ctx, realID)
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "not_found")
		return item, false
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return item, false
	}
	if !a.budgetAuth(w, ctx, user, permission, proposal) {
		return item, false
	}
	return item, true
}
func (a *API) evidenceList(w http.ResponseWriter, r *http.Request) {
	id, user := chi.URLParam(r, "id"), actor(r.Context())
	if _, ok := a.evidenceAuth(w, r.Context(), user, "subbagren.anggaran.bukti.read", id); !ok {
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT id::text,realisasi_id::text,filename,mime_type,size_bytes,sha256,status,uploaded_by::text,reviewer_id::text,review_reason,version,created_at FROM sdl_subbagren_evidence WHERE realisasi_id=$1 ORDER BY created_at DESC,id DESC LIMIT 11`, id)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	items := []Evidence{}
	for rows.Next() {
		var e Evidence
		if rows.Scan(&e.ID, &e.RealisasiID, &e.Filename, &e.MIME, &e.Size, &e.SHA256, &e.Status, &e.UploadedBy, &e.ReviewerID, &e.ReviewReason, &e.Version, &e.CreatedAt) != nil {
			reject(w, 503, "unavailable")
			return
		}
		items = append(items, e)
	}
	if rows.Err() != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"items": items, "limited": len(items) > 10})
}
func (a *API) evidenceUpload(w http.ResponseWriter, r *http.Request) {
	id, user := chi.URLParam(r, "id"), actor(r.Context())
	parent, ok := a.evidenceAuth(w, r.Context(), user, "subbagren.anggaran.bukti.upload", id)
	if !ok {
		return
	}
	if parent.Status != "pending" {
		reject(w, 409, "realization_not_pending")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxEvidenceBytes+65536)
	if err := r.ParseMultipartForm(maxEvidenceBytes + 65536); err != nil {
		reject(w, 413, "invalid_upload")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	reason := r.FormValue("reason")
	if !validReason(reason) {
		reject(w, 400, "invalid_reason")
		return
	}
	files := r.MultipartForm.File["file"]
	if len(files) != 1 {
		reject(w, 400, "one_file_required")
		return
	}
	f, err := files[0].Open()
	if err != nil {
		reject(w, 400, "file_required")
		return
	}
	defer f.Close()
	blob, err := io.ReadAll(io.LimitReader(f, maxEvidenceBytes+1))
	if err != nil || len(blob) > maxEvidenceBytes {
		reject(w, 413, "file_too_large")
		return
	}
	filename := strings.TrimSpace(files[0].Filename)
	kind, valid := validateEvidence(filename, blob)
	if !valid {
		reject(w, 400, "invalid_file_type")
		return
	}
	digest := sha256.Sum256(blob)
	sealed, encryptErr := sealEvidence(a.EvidenceKey, blob)
	if encryptErr != nil {
		reject(w, 503, "evidence_encryption_unavailable")
		return
	}
	// Lock parent transaction and insert; two simultaneous uploads cannot both become active.
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var status string
	err = tx.QueryRow(r.Context(), `SELECT status FROM sdl_subbagren_realisasi WHERE id=$1 FOR UPDATE`, id).Scan(&status)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if status != "pending" {
		reject(w, 409, "realization_not_pending")
		return
	}
	var active bool
	err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_subbagren_evidence WHERE realisasi_id=$1 AND status IN ('pending','approved'))`, id).Scan(&active)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if active {
		reject(w, 409, "active_evidence_exists")
		return
	}
	var proofID string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_subbagren_evidence(realisasi_id,uploaded_by,filename,mime_type,size_bytes,sha256,body) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`, id, user, filename, kind, len(blob), hex.EncodeToString(digest[:]), sealed).Scan(&proofID)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if a.evidenceEvent(r.Context(), tx, proofID, user, "uploaded", reason) != nil || tx.Commit(r.Context()) != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 201, map[string]any{"id": proofID, "status": "pending", "sha256": hex.EncodeToString(digest[:]), "note": "file_private_independent_review_required"})
}
func (a *API) evidenceEvent(ctx context.Context, tx pgx.Tx, id, user, action, reason string) error {
	_, err := tx.Exec(ctx, `INSERT INTO sdl_subbagren_evidence_events(evidence_id,actor_id,action,reason) VALUES($1,$2,$3,$4)`, id, user, action, strings.TrimSpace(reason))
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,$2,'subbagren.evidence',$3)`, user, "subbagren.anggaran.bukti."+action, id)
	return err
}
func (a *API) evidenceDownload(w http.ResponseWriter, r *http.Request) {
	id, proofID, user := chi.URLParam(r, "id"), chi.URLParam(r, "proofId"), actor(r.Context())
	if _, ok := a.evidenceAuth(w, r.Context(), user, "subbagren.anggaran.bukti.read", id); !ok {
		return
	}
	var filename, sha, media string
	var blob []byte
	err := a.DB.QueryRow(r.Context(), `SELECT filename,mime_type,sha256,body FROM sdl_subbagren_evidence WHERE id=$1 AND realisasi_id=$2`, proofID, id).Scan(&filename, &media, &sha, &blob)
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "not_found")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	clear, decryptErr := openEvidence(a.EvidenceKey, blob)
	if decryptErr != nil {
		reject(w, 503, "evidence_integrity_failure")
		return
	}
	sum := sha256.Sum256(clear)
	if hex.EncodeToString(sum[:]) != sha {
		reject(w, 503, "evidence_integrity_failure")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	if a.evidenceEvent(r.Context(), tx, proofID, user, "downloaded", "Authorized file download") != nil || tx.Commit(r.Context()) != nil {
		reject(w, 503, "unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(200)
	_, _ = w.Write(clear)
}

type evidenceReviewRequest struct {
	Version  int64  `json:"version"`
	Decision string `json:"decision"`
	Reason   string `json:"reason"`
}

func (a *API) evidenceReview(w http.ResponseWriter, r *http.Request) {
	var req evidenceReviewRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Version < 1 || (req.Decision != "approved" && req.Decision != "rejected") || !validReason(req.Reason) {
		reject(w, 400, "invalid_input")
		return
	}
	id, proofID, user := chi.URLParam(r, "id"), chi.URLParam(r, "proofId"), actor(r.Context())
	// Auth before lock; live grant checked for every mutation.
	if _, ok := a.evidenceAuth(w, r.Context(), user, "subbagren.anggaran.bukti.verify", id); !ok {
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var paguID string
	err = tx.QueryRow(r.Context(), `SELECT pagu_id::text FROM sdl_subbagren_realisasi WHERE id=$1`, id).Scan(&paguID)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	// Same lock order as realization verification: parent pagu -> realization -> evidence.
	var paguStatus string
	err = tx.QueryRow(r.Context(), `SELECT status FROM sdl_subbagren_pagu WHERE id=$1 FOR UPDATE`, paguID).Scan(&paguStatus)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	var realStatus, realMaker string
	err = tx.QueryRow(r.Context(), `SELECT status,created_by::text FROM sdl_subbagren_realisasi WHERE id=$1 FOR UPDATE`, id).Scan(&realStatus, &realMaker)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if realStatus != "pending" || paguStatus != "verified" {
		reject(w, 409, "realization_not_pending")
		return
	}
	var status, maker, savedDigest string
	var cipherBlob []byte
	var version int64
	err = tx.QueryRow(r.Context(), `SELECT status,uploaded_by::text,version,sha256,body FROM sdl_subbagren_evidence WHERE id=$1 AND realisasi_id=$2 FOR UPDATE`, proofID, id).Scan(&status, &maker, &version, &savedDigest, &cipherBlob)
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "not_found")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if maker == user || realMaker == user {
		reject(w, 403, "self_verification_denied")
		return
	}
	if status != "pending" || version != req.Version {
		reject(w, 409, "version_or_status_conflict")
		return
	}
	if req.Decision == "approved" {
		plain, decryptErr := openEvidence(a.EvidenceKey, cipherBlob)
		if decryptErr != nil {
			reject(w, 409, "evidence_integrity_failure")
			return
		}
		h := sha256.Sum256(plain)
		if hex.EncodeToString(h[:]) != savedDigest {
			reject(w, 409, "evidence_integrity_failure")
			return
		}
	}
	_, err = tx.Exec(r.Context(), `UPDATE sdl_subbagren_evidence SET status=$1,reviewer_id=$2,review_reason=$3,reviewed_at=now(),version=version+1 WHERE id=$4`, req.Decision, user, strings.TrimSpace(req.Reason), proofID)
	if err != nil || a.evidenceEvent(r.Context(), tx, proofID, user, req.Decision, req.Reason) != nil || tx.Commit(r.Context()) != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"id": proofID, "status": req.Decision, "version": version + 1})
}

type reconcileUnit struct {
	Unit                 string `json:"unit"`
	PaguVerified         string `json:"paguVerified"`
	RealizationVerified  string `json:"realizationVerified"`
	PendingTransactions  int    `json:"pendingTransactions"`
	RejectedTransactions int    `json:"rejectedTransactions"`
	MissingEvidence      int    `json:"missingEvidence"`
	PendingEvidence      int    `json:"pendingEvidence"`
	RejectedEvidence     int    `json:"rejectedEvidence"`
}
type reconcileCounters struct {
	pagu, verified                                int64
	pending, rejected, missing, waiting, declined int
}

func (a *API) budgetReconciliation(w http.ResponseWriter, r *http.Request) {
	year, err := strconv.Atoi(r.URL.Query().Get("year"))
	if err != nil || year < 2020 || year > 2100 {
		reject(w, 400, "invalid_year")
		return
	}
	user := actor(r.Context())
	sentinel := Proposal{CreatedBy: user, Classification: "biasa", Status: "submitted"}
	if !a.budgetAuth(w, r.Context(), user, "subbagren.anggaran.reconcile", sentinel) {
		return
	}
	// Explicitly bounded: show incomplete data as incomplete, never as official totals.
	rows, err := a.DB.Query(r.Context(), paguCols+` WHERE p.fiscal_year=$1 ORDER BY b.created_at DESC,b.id DESC LIMIT 201`, year)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	pagus := []Pagu{}
	for rows.Next() {
		v, e := scanPagu(rows)
		if e != nil {
			err = e
			break
		}
		pagus = append(pagus, v)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	totals := map[string]*reconcileCounters{}
	limited := len(pagus) > 200
	for i, b := range pagus {
		if i == 200 {
			break
		}
		p, e := a.budgetProposal(r.Context(), b.ProposalID)
		if e != nil {
			reject(w, 503, "unavailable")
			return
		}
		grant, e := a.permitted(r.Context(), user, "subbagren.usulan.read", p)
		if e != nil {
			reject(w, 503, "authorization_unavailable")
			return
		}
		if !grant {
			continue
		}
		grant, e = a.permitted(r.Context(), user, "subbagren.anggaran.read", p)
		if e != nil {
			reject(w, 503, "authorization_unavailable")
			return
		}
		if !grant {
			continue
		}
		unit := p.SourceUnit
		c := totals[unit]
		if c == nil {
			c = &reconcileCounters{}
			totals[unit] = c
		}
		if b.Status == "verified" {
			n, _ := strconv.ParseInt(b.Amount, 10, 64)
			c.pagu += n
		}
		rr, e := a.DB.Query(r.Context(), `SELECT t.amount,t.status,COALESCE((SELECT ee.status FROM sdl_subbagren_evidence ee WHERE ee.realisasi_id=t.id ORDER BY ee.created_at DESC,ee.id DESC LIMIT 1),'missing') FROM sdl_subbagren_realisasi t WHERE t.pagu_id=$1 ORDER BY t.created_at DESC,t.id DESC LIMIT 201`, b.ID)
		if e != nil {
			reject(w, 503, "unavailable")
			return
		}
		count := 0
		for rr.Next() {
			count++
			if count > 200 {
				limited = true
				break
			}
			var amount int64
			var status, proof string
			if e = rr.Scan(&amount, &status, &proof); e != nil {
				break
			}
			if status == "verified" {
				c.verified += amount
			}
			if status == "pending" {
				c.pending++
			}
			if status == "rejected" {
				c.rejected++
			}
			if proof == "missing" {
				c.missing++
			}
			if proof == "pending" {
				c.waiting++
			}
			if proof == "rejected" {
				c.declined++
			}
		}
		if e == nil {
			e = rr.Err()
		}
		rr.Close()
		if e != nil {
			reject(w, 503, "unavailable")
			return
		}
	}
	keys := make([]string, 0, len(totals))
	for k := range totals {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	units := []reconcileUnit{}
	for _, k := range keys {
		c := totals[k]
		units = append(units, reconcileUnit{Unit: k, PaguVerified: strconv.FormatInt(c.pagu, 10), RealizationVerified: strconv.FormatInt(c.verified, 10), PendingTransactions: c.pending, RejectedTransactions: c.rejected, MissingEvidence: c.missing, PendingEvidence: c.waiting, RejectedEvidence: c.declined})
	}
	respond(w, 200, map[string]any{"year": year, "units": units, "limited": limited, "basis": "verified_only_scoped", "officialLRA": false, "note": "Requires original-source reconciliation and external DIPA/SP2D validation"})
}
