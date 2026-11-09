package subbagren

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// R4A3A: independent maker-checker budget registration and realization.
// Financial figures are derived exclusively from verified records.
// R4A3A keeps metadata references. R4A3B stores independently reviewed, encrypted files.
type Pagu struct {
	ID                  string `json:"id"`
	ProposalID          string `json:"proposalId"`
	ProposalTitle       string `json:"proposalTitle"`
	FiscalYear          int    `json:"fiscalYear"`
	Classification      string `json:"classification"`
	Amount              string `json:"amount"`
	AuthorizationNumber string `json:"authorizationNumber"`
	AuthorizationIssuer string `json:"authorizationIssuer"`
	AuthorizationDate   string `json:"authorizationDate"`
	Status              string `json:"status"`
	CreatedBy           string `json:"createdBy"`
	Version             int64  `json:"version"`
	VerifiedRealization string `json:"verifiedRealization"`
	Remaining           string `json:"remaining"`
}
type Realisasi struct {
	ID                string `json:"id"`
	PaguID            string `json:"paguId"`
	Amount            string `json:"amount"`
	TransactionDate   string `json:"transactionDate"`
	EvidenceReference string `json:"evidenceReference"`
	Description       string `json:"description"`
	Status            string `json:"status"`
	CreatedBy         string `json:"createdBy"`
	Version           int64  `json:"version"`
}
type paguRequest struct {
	ProposalID          string `json:"proposalId"`
	Amount              int64  `json:"amount"`
	AuthorizationNumber string `json:"authorizationNumber"`
	AuthorizationIssuer string `json:"authorizationIssuer"`
	AuthorizationDate   string `json:"authorizationDate"`
	Reason              string `json:"reason"`
}
type realisasiRequest struct {
	PaguID            string `json:"paguId"`
	Amount            int64  `json:"amount"`
	TransactionDate   string `json:"transactionDate"`
	EvidenceReference string `json:"evidenceReference"`
	Description       string `json:"description"`
	Reason            string `json:"reason"`
}
type checkRequest struct {
	Version  int64  `json:"version"`
	Decision string `json:"decision"`
	Reason   string `json:"reason"`
}

const paguCols = `SELECT b.id::text,b.proposal_id::text,p.title,p.fiscal_year,p.classification,b.amount,b.authorization_number,b.authorization_issuer,b.authorization_date::text,b.status,b.created_by::text,b.version FROM sdl_subbagren_pagu b JOIN sdl_subbagren_proposals p ON p.id=b.proposal_id`
const realisasiCols = `SELECT t.id::text,t.pagu_id::text,t.amount,t.transaction_date::text,t.evidence_reference,t.description,t.status,t.created_by::text,t.version FROM sdl_subbagren_realisasi t`

func validDate(s string) (time.Time, bool) {
	d, err := time.Parse("2006-01-02", s)
	return d, err == nil && d.Year() >= 2020 && d.Year() <= 2100 && d.Format("2006-01-02") == s
}
func amountOK(n int64) bool { return n > 0 && n <= 1000000000000000 }
func scanPagu(s scanner) (Pagu, error) {
	var b Pagu
	var amount int64
	err := s.Scan(&b.ID, &b.ProposalID, &b.ProposalTitle, &b.FiscalYear, &b.Classification, &amount, &b.AuthorizationNumber, &b.AuthorizationIssuer, &b.AuthorizationDate, &b.Status, &b.CreatedBy, &b.Version)
	b.Amount = strconv.FormatInt(amount, 10)
	return b, err
}
func scanRealisasi(s scanner) (Realisasi, error) {
	var v Realisasi
	var amount int64
	err := s.Scan(&v.ID, &v.PaguID, &amount, &v.TransactionDate, &v.EvidenceReference, &v.Description, &v.Status, &v.CreatedBy, &v.Version)
	v.Amount = strconv.FormatInt(amount, 10)
	return v, err
}
func (a *API) BudgetRoutes(r chi.Router) {
	r.Get("/", a.budgetOverview)
	r.Get("/capabilities", a.budgetCapabilities)
	r.Post("/pagu", a.budgetPaguRegister)
	r.Post("/pagu/{id}/review", a.budgetPaguReview)
	r.Post("/realisasi", a.budgetRealisasiRecord)
	r.Post("/realisasi/{id}/review", a.budgetRealisasiReview)
	r.Get("/realisasi/{id}/evidence", a.evidenceList)
	r.Post("/realisasi/{id}/evidence", a.evidenceUpload)
	r.Get("/realisasi/{id}/evidence/{proofId}/download", a.evidenceDownload)
	r.Post("/realisasi/{id}/evidence/{proofId}/review", a.evidenceReview)
	r.Get("/reconciliation", a.budgetReconciliation)
}
func (a *API) budgetCapabilities(w http.ResponseWriter, r *http.Request) {
	user := actor(r.Context())
	sample := Proposal{CreatedBy: user, Classification: "biasa", Status: "submitted"}
	keys := map[string]string{"read": "subbagren.anggaran.read", "register": "subbagren.anggaran.pagu.register", "verifyPagu": "subbagren.anggaran.pagu.verify", "record": "subbagren.anggaran.realisasi.record", "verifyRealization": "subbagren.anggaran.realisasi.verify", "uploadEvidence": "subbagren.anggaran.bukti.upload", "readEvidence": "subbagren.anggaran.bukti.read", "reviewEvidence": "subbagren.anggaran.bukti.verify", "reconcile": "subbagren.anggaran.reconcile"}
	result := map[string]bool{}
	for label, key := range keys {
		ok, e := a.permitted(r.Context(), user, key, sample)
		if e != nil {
			reject(w, 503, "authorization_unavailable")
			return
		}
		result[label] = ok
	}
	respond(w, 200, result)
}
func (a *API) budgetAuth(w http.ResponseWriter, ctx context.Context, user, permission string, p Proposal) bool {
	for _, key := range []string{"subbagren.usulan.read", "subbagren.anggaran.read", permission} {
		ok, err := a.permitted(ctx, user, key, p)
		if err != nil {
			reject(w, 503, "authorization_unavailable")
			return false
		}
		if !ok {
			reject(w, 404, "not_found")
			return false
		}
	}
	return true
}
func (a *API) budgetProposal(ctx context.Context, id string) (Proposal, error) {
	return scan(a.DB.QueryRow(ctx, columns+` WHERE id::text=$1`, id))
}
func (a *API) paguByID(ctx context.Context, id string) (Pagu, error) {
	return scanPagu(a.DB.QueryRow(ctx, paguCols+` WHERE b.id::text=$1`, id))
}
func (a *API) budgetEvent(ctx context.Context, tx pgx.Tx, typ, id, user, action, reason string) error {
	_, err := tx.Exec(ctx, `INSERT INTO sdl_subbagren_budget_events(subject_type,subject_id,actor_id,action,reason) VALUES($1,$2,$3,$4,$5)`, typ, id, user, action, strings.TrimSpace(reason))
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,$2,$3,$4)`, user, "subbagren.anggaran."+action, "subbagren."+typ, id)
	return err
}
func (a *API) budgetPaguRegister(w http.ResponseWriter, r *http.Request) {
	var req paguRequest
	if !decode(w, r, &req) {
		return
	}
	date, okDate := validDate(req.AuthorizationDate)
	if !amountOK(req.Amount) || !textOK(req.AuthorizationNumber, 6, 160) || !textOK(req.AuthorizationIssuer, 5, 160) || !validReason(req.Reason) || !okDate || date.After(time.Now().UTC().Add(24*time.Hour)) {
		reject(w, 400, "invalid_input")
		return
	}
	p, err := a.budgetProposal(r.Context(), req.ProposalID)
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "not_found")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	user := actor(r.Context())
	if !a.budgetAuth(w, r.Context(), user, "subbagren.anggaran.pagu.register", p) {
		return
	}
	if p.Status != "submitted" {
		reject(w, 409, "proposal_not_submitted")
		return
	}
	review, err := a.getReviewCase(r.Context(), p.ID)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if review.Status != "approved" {
		reject(w, 409, "internal_review_required")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var id string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_subbagren_pagu(proposal_id,amount,authorization_number,authorization_issuer,authorization_date,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(proposal_id) DO NOTHING RETURNING id::text`, p.ID, req.Amount, strings.TrimSpace(req.AuthorizationNumber), strings.TrimSpace(req.AuthorizationIssuer), req.AuthorizationDate, user).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 409, "pagu_already_registered")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if a.budgetEvent(r.Context(), tx, "pagu", id, user, "registered", req.Reason) != nil || tx.Commit(r.Context()) != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 201, map[string]any{"id": id, "status": "pending", "note": "requires_independent_document_verification"})
}
func (a *API) budgetPaguReview(w http.ResponseWriter, r *http.Request) {
	var req checkRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Version < 1 || !validReason(req.Reason) || (req.Decision != "verified" && req.Decision != "rejected") {
		reject(w, 400, "invalid_input")
		return
	}
	id, user := chi.URLParam(r, "id"), actor(r.Context())
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var proposalID, creator, status string
	var version int64
	err = tx.QueryRow(r.Context(), `SELECT proposal_id::text,created_by::text,status,version FROM sdl_subbagren_pagu WHERE id::text=$1 FOR UPDATE`, id).Scan(&proposalID, &creator, &status, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "not_found")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	p, err := a.budgetProposal(r.Context(), proposalID)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if !a.budgetAuth(w, r.Context(), user, "subbagren.anggaran.pagu.verify", p) {
		return
	}
	if creator == user {
		reject(w, 403, "self_verification_denied")
		return
	}
	if status != "pending" || version != req.Version {
		reject(w, 409, "version_or_status_conflict")
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE sdl_subbagren_pagu SET status=$1,reviewed_by=$2,review_reason=$3,reviewed_at=now(),version=version+1 WHERE id::text=$4`, req.Decision, user, strings.TrimSpace(req.Reason), id)
	if err != nil || a.budgetEvent(r.Context(), tx, "pagu", id, user, req.Decision, req.Reason) != nil || tx.Commit(r.Context()) != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"id": id, "status": req.Decision, "version": version + 1})
}
func (a *API) budgetRealisasiRecord(w http.ResponseWriter, r *http.Request) {
	var req realisasiRequest
	if !decode(w, r, &req) {
		return
	}
	date, ok := validDate(req.TransactionDate)
	if !amountOK(req.Amount) || !ok || date.After(time.Now().UTC()) || !textOK(req.EvidenceReference, 8, 200) || !textOK(req.Description, 8, 500) || !validReason(req.Reason) {
		reject(w, 400, "invalid_input")
		return
	}
	b, err := a.paguByID(r.Context(), req.PaguID)
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "not_found")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	p, err := a.budgetProposal(r.Context(), b.ProposalID)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	user := actor(r.Context())
	if !a.budgetAuth(w, r.Context(), user, "subbagren.anggaran.realisasi.record", p) {
		return
	}
	if b.Status != "verified" {
		reject(w, 409, "pagu_not_verified")
		return
	}
	if date.Year() != b.FiscalYear {
		reject(w, 400, "transaction_year_mismatch")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var id string
	err = tx.QueryRow(r.Context(), `INSERT INTO sdl_subbagren_realisasi(pagu_id,amount,transaction_date,evidence_reference,description,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`, b.ID, req.Amount, req.TransactionDate, strings.TrimSpace(req.EvidenceReference), strings.TrimSpace(req.Description), user).Scan(&id)
	if err != nil || a.budgetEvent(r.Context(), tx, "realisasi", id, user, "recorded", req.Reason) != nil || tx.Commit(r.Context()) != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 201, map[string]any{"id": id, "status": "pending", "note": "not_in_verified_realization"})
}
func (a *API) budgetRealisasiReview(w http.ResponseWriter, r *http.Request) {
	var req checkRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Version < 1 || !validReason(req.Reason) || (req.Decision != "verified" && req.Decision != "rejected") {
		reject(w, 400, "invalid_input")
		return
	}
	id, user := chi.URLParam(r, "id"), actor(r.Context())
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	// Lock the parent pagu FIRST. Concurrent reviewer requests serialize on that row.
	var paguID string
	err = tx.QueryRow(r.Context(), `SELECT pagu_id::text FROM sdl_subbagren_realisasi WHERE id::text=$1`, id).Scan(&paguID)
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "not_found")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	var proposalID, paguStatus string
	var paguAmount int64
	err = tx.QueryRow(r.Context(), `SELECT proposal_id::text,status,amount FROM sdl_subbagren_pagu WHERE id::text=$1 FOR UPDATE`, paguID).Scan(&proposalID, &paguStatus, &paguAmount)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	p, err := a.budgetProposal(r.Context(), proposalID)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if !a.budgetAuth(w, r.Context(), user, "subbagren.anggaran.realisasi.verify", p) {
		return
	}
	var amount, version int64
	var status, creator string
	err = tx.QueryRow(r.Context(), `SELECT amount,status,created_by::text,version FROM sdl_subbagren_realisasi WHERE id::text=$1 FOR UPDATE`, id).Scan(&amount, &status, &creator, &version)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if creator == user {
		reject(w, 403, "self_verification_denied")
		return
	}
	if status != "pending" || version != req.Version {
		reject(w, 409, "version_or_status_conflict")
		return
	}
	if paguStatus != "verified" {
		reject(w, 409, "pagu_not_verified")
		return
	}
	if req.Decision == "verified" {
		// R4A3B: an independently approved, immutable file is mandatory for new verifications.
		// Previously verified transactions are never retroactively changed.
		var evidenceApproved bool
		if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_subbagren_evidence WHERE realisasi_id=$1 AND status='approved')`, id).Scan(&evidenceApproved); err != nil {
			reject(w, 503, "unavailable")
			return
		}
		if !evidenceApproved {
			reject(w, 409, "approved_evidence_required")
			return
		}
		// Recheck immutable proof integrity before financial verification.
		var proofBytes []byte
		var proofHash string
		if err = tx.QueryRow(r.Context(), `SELECT body,sha256 FROM sdl_subbagren_evidence WHERE realisasi_id=$1 AND status='approved'`, id).Scan(&proofBytes, &proofHash); err != nil {
			reject(w, 503, "unavailable")
			return
		}
		plain, decryptErr := openEvidence(a.EvidenceKey, proofBytes)
		if decryptErr != nil {
			reject(w, 409, "evidence_integrity_failure")
			return
		}
		sum := sha256.Sum256(plain)
		if hex.EncodeToString(sum[:]) != proofHash {
			reject(w, 409, "evidence_integrity_failure")
			return
		}
		var used int64
		if err = tx.QueryRow(r.Context(), `SELECT COALESCE(SUM(amount),0)::bigint FROM sdl_subbagren_realisasi WHERE pagu_id=$1 AND status='verified'`, paguID).Scan(&used); err != nil {
			reject(w, 503, "unavailable")
			return
		}
		if used > paguAmount || amount > paguAmount-used {
			reject(w, 409, "insufficient_remaining_pagu")
			return
		}
	}
	_, err = tx.Exec(r.Context(), `UPDATE sdl_subbagren_realisasi SET status=$1,reviewed_by=$2,review_reason=$3,reviewed_at=now(),version=version+1 WHERE id::text=$4`, req.Decision, user, strings.TrimSpace(req.Reason), id)
	if err != nil || a.budgetEvent(r.Context(), tx, "realisasi", id, user, req.Decision, req.Reason) != nil || tx.Commit(r.Context()) != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"id": id, "status": req.Decision, "version": version + 1})
}
func (a *API) budgetOverview(w http.ResponseWriter, r *http.Request) {
	year, err := strconv.Atoi(r.URL.Query().Get("year"))
	if err != nil || year < 2020 || year > 2100 {
		reject(w, 400, "invalid_year")
		return
	}
	user := actor(r.Context())
	// Fail closed even with no records: no 'empty dashboard' inference for unauthorized actors.
	sentinel := Proposal{CreatedBy: user, Classification: "biasa", Status: "submitted"}
	ok, err := a.permitted(r.Context(), user, "subbagren.anggaran.read", sentinel)
	if err != nil {
		reject(w, 503, "authorization_unavailable")
		return
	}
	if !ok {
		reject(w, 403, "access_denied")
		return
	}
	rows, err := a.DB.Query(r.Context(), paguCols+` WHERE p.fiscal_year=$1 ORDER BY b.created_at DESC LIMIT 201`, year)
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
	items := []Pagu{}
	realizations := []Realisasi{}
	var totalPagu, totalUsed int64
	for _, v := range pagus {
		p, e := a.budgetProposal(r.Context(), v.ProposalID)
		if e != nil {
			reject(w, 503, "unavailable")
			return
		}
		allowed, e := a.permitted(r.Context(), user, "subbagren.usulan.read", p)
		if e != nil {
			reject(w, 503, "authorization_unavailable")
			return
		}
		if !allowed {
			continue
		}
		allowed, e = a.permitted(r.Context(), user, "subbagren.anggaran.read", p)
		if e != nil {
			reject(w, 503, "authorization_unavailable")
			return
		}
		if !allowed {
			continue
		}
		var used int64
		if e := a.DB.QueryRow(r.Context(), `SELECT COALESCE(SUM(amount),0)::bigint FROM sdl_subbagren_realisasi WHERE pagu_id=$1 AND status='verified'`, v.ID).Scan(&used); e != nil {
			reject(w, 503, "unavailable")
			return
		}
		rows2, e := a.DB.Query(r.Context(), realisasiCols+` WHERE t.pagu_id=$1 ORDER BY t.created_at DESC LIMIT 201`, v.ID)
		if e != nil {
			reject(w, 503, "unavailable")
			return
		}
		for rows2.Next() {
			t, scanErr := scanRealisasi(rows2)
			if scanErr != nil {
				e = scanErr
				break
			}
			if len(realizations) < 200 {
				realizations = append(realizations, t)
			}

		}
		if e == nil {
			e = rows2.Err()
		}
		rows2.Close()
		if e != nil {
			reject(w, 503, "unavailable")
			return
		}
		v.VerifiedRealization = strconv.FormatInt(used, 10)
		v.Remaining = "0"
		if v.Status == "verified" {
			amount, _ := strconv.ParseInt(v.Amount, 10, 64)
			v.Remaining = strconv.FormatInt(amount-used, 10)
			totalPagu += amount
			totalUsed += used
		}
		items = append(items, v)
	}
	respond(w, 200, map[string]any{"year": year, "pagus": items, "realizations": realizations, "totals": map[string]string{"paguVerified": strconv.FormatInt(totalPagu, 10), "realizationVerified": strconv.FormatInt(totalUsed, 10), "remaining": strconv.FormatInt(totalPagu-totalUsed, 10)}, "basis": "verified_only", "limited": len(pagus) == 201 || len(realizations) >= 200, "note": "evidence_files_require_independent_review; reconciliation_not_official_LRA"})
}
