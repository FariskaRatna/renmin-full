package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// A local SHA-256 proof-of-work challenge. This raises automated login cost,
// not a substitute for OTP, IP throttling or credential attack monitoring.
const captchaDifficulty = 16
const captchaLifetime = 120 * time.Second

type captchaSubmission struct {
	ID      string `json:"id"`
	Counter uint32 `json:"counter"`
}

func remoteIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return ip
	}
	return r.RemoteAddr // Never trust client-controlled forwarded headers.
}

func proofIsValid(nonce string, counter uint32) bool {
	if counter > 5000000 {
		return false
	}
	sum := sha256.Sum256([]byte(nonce + ":" + strconv.FormatUint(uint64(counter), 10)))
	return sum[0] == 0 && sum[1] == 0
}

func (s *Service) captchaChallenge(w http.ResponseWriter, r *http.Request) {
	ipDigest := s.signature("captcha-peer", remoteIP(r))
	var count int
	if err := s.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM sdl_captcha_challenges WHERE client_hash=$1 AND created_at>NOW()-INTERVAL '1 minute'`, ipDigest).Scan(&count); err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if count >= 60 {
		problem(w, 429, "try_later")
		return
	}
	id, err := newRandom(32)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	nonce, err := newRandom(18)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	_, err = s.db.Exec(r.Context(), `INSERT INTO sdl_captcha_challenges(challenge_hash,client_hash,nonce,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '2 minutes')`, tokenHash(id), ipDigest, nonce)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	write(w, 200, map[string]any{"id": id, "nonce": nonce, "difficulty": captchaDifficulty, "expiresInSeconds": 120})
}

// Transactionally consumes a challenge before any credential query. Invalid
// and replayed proofs always fail closed, including concurrent requests.
func (s *Service) consumeCaptcha(ctx context.Context, r *http.Request, p captchaSubmission) (bool, error) {
	if len(p.ID) != 43 || p.Counter > 5000000 {
		return false, nil
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var nonce, ipDigest string
	var expires time.Time
	var consumed *time.Time
	err = tx.QueryRow(ctx, `SELECT nonce,client_hash,expires_at,consumed_at FROM sdl_captcha_challenges WHERE challenge_hash=$1 FOR UPDATE`, tokenHash(p.ID)).Scan(&nonce, &ipDigest, &expires, &consumed)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if consumed != nil || !time.Now().Before(expires) || !strings.EqualFold(ipDigest, s.signature("captcha-peer", remoteIP(r))) || !proofIsValid(nonce, p.Counter) {
		return false, nil
	}
	tag, err := tx.Exec(ctx, `UPDATE sdl_captcha_challenges SET consumed_at=NOW() WHERE challenge_hash=$1 AND consumed_at IS NULL`, tokenHash(p.ID))
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() != 1 {
		return false, nil
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

// Public GET responses are always no-store; do not allow POST as a cacheable challenge.
func (s *Service) captchaGet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	s.captchaChallenge(w, r)
}
