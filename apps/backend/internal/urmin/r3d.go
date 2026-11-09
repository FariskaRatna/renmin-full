package urmin

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// SLA uses UTC calendar dates consistently with the R3C date-only due date.
// It is calculated on read, so overdue tasks require no scheduler or updates.
func dispositionSLA(t dispositionTask, now time.Time) string {
	due, err := time.Parse("2006-01-02", t.DueDate)
	if err != nil {
		return "unknown"
	}
	if t.Status == "completed" {
		if t.CompletedAt == nil {
			return "unknown"
		}
		if !t.CompletedAt.UTC().Before(due.Add(24 * time.Hour)) {
			return "completed_late"
		}
		return "completed_on_time"
	}
	if now.UTC().Format("2006-01-02") > t.DueDate {
		return "overdue"
	}
	return "on_track"
}

// One immutable decision per completed task. A revision request does NOT
// silently reopen a completed task: issuer must create a separately audited
// follow-up task. Hierarchical forwarding is deliberately out of R3D1 scope.
func (a *API) reviewDisposition(w http.ResponseWriter, r *http.Request) {
	id, user := chi.URLParam(r, "taskId"), actor(r.Context())
	if !uuidPattern.MatchString(id) {
		fail(w, 404, "not_found")
		return
	}
	var p struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
		Version  int64  `json:"version"`
	}
	if !readJSON(w, r, &p) {
		return
	}
	if (p.Decision != "approved" && p.Decision != "revision_requested") || !validText(p.Reason, 8, 1000) || p.Version < 1 {
		fail(w, 400, "invalid_input")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	t, err := scanTask(tx.QueryRow(r.Context(), taskSelect+` WHERE t.id=$1 FOR UPDATE OF t`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if t.IssuerID != user {
		fail(w, 404, "not_found")
		return
	}
	allowed, err := a.taskChainValid(r.Context(), t)
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 403, "access_denied")
		return
	}
	allowed, err = a.dispositionEligible(r.Context(), user, t.Unit, t.Classification, "urmin.disposisi.review")
	if err != nil {
		fail(w, 503, "authorization_unavailable")
		return
	}
	if !allowed {
		fail(w, 403, "access_denied")
		return
	}
	if t.Version != p.Version || !dispositionReviewEligible(t, user) {
		fail(w, 409, "review_state_conflict")
		return
	}
	result, err := tx.Exec(r.Context(), `INSERT INTO sdl_urmin_disposition_reviews(disposition_id,reviewed_by,decision,reason) VALUES($1,$2,$3,$4) ON CONFLICT (disposition_id) DO NOTHING`, id, user, p.Decision, strings.TrimSpace(p.Reason))
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if result.RowsAffected() != 1 {
		fail(w, 409, "review_already_exists")
		return
	}
	if err = audit(r.Context(), tx, user, "urmin.disposisi.review."+p.Decision, id); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	event := "review_approved"
	if p.Decision == "revision_requested" {
		event = "review_revision"
	}
	if err = enqueueUrminEmail(r.Context(), tx, id, t.AssigneeID, event); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	// R5G8: pekerjaan yang disahkan langsung masuk register Arsip Urmin, di
	// transaksi yang sama dengan telaahnya. Yang diminta diperbaiki tidak.
	//
	// SENGAJA TIDAK digerbangi archiveRegisterAllowed, berbeda dari endpoint
	// 143. Penerbit yang menelaah hampir selalu berada di subbagren/sumda/
	// binfung dan tidak punya grant di unit 'urmin', jadi menggerbanginya akan
	// membuat pengarsipan otomatis ini tidak pernah berjalan untuk kasus yang
	// paling lazim — bentuk kegagalan B9 lagi. Di sini entri arsip adalah
	// AKIBAT dari aksi yang sudah berwenang (telaahnya), bukan aksi tersendiri,
	// persis seperti antrean email di atasnya yang juga tidak digerbangi.
	// Siapa yang boleh MEMBACA entri itu tetap ditentukan Engine B seperti
	// biasa.
	if p.Decision == "approved" {
		if _, _, _, _, e := a.writeDispositionArchive(r.Context(), tx, user, t); e != nil {
			fail(w, 503, "unavailable")
			return
		}
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable")
		return
	}
	jsonResponse(w, 200, map[string]any{"id": id, "reviewStatus": p.Decision})
}

// This pure helper can be unit-tested without any real credentials or DB.
func dispositionReviewEligible(t dispositionTask, reviewer string) bool {
	return reviewer != "" && reviewer == t.IssuerID && t.Status == "completed" && t.ReviewStatus == "awaiting_review"
}
