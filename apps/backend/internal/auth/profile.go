package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

var phonePattern = regexp.MustCompile(`^[+0-9() .-]{0,40}$`)

const maxAvatarUpload = 2 << 20

func validProfileName(name string) bool {
	name = strings.TrimSpace(name)
	return len([]rune(name)) >= 3 && len([]rune(name)) <= 160 && !strings.ContainsAny(name, "\r\n\x00")
}
func validProfilePhone(phone string) bool { return phonePattern.MatchString(phone) }
func validProfileEmail(email string) bool {
	if len(email) < 5 || len(email) > 254 || strings.ContainsAny(email, "\r\n\x00") {
		return false
	}
	addr, err := mail.ParseAddress(email)
	return err == nil && addr.Address == email && strings.Contains(email, "@")
}
func (s *Service) profileGet(w http.ResponseWriter, r *http.Request) {
	id, err := s.currentUser(r)
	if err != nil {
		problem(w, 401, "unauthenticated")
		return
	}
	var name, email, username, phone string
	var hasAvatar bool
	err = s.db.QueryRow(r.Context(), `SELECT display_name,email,username,COALESCE(profile_phone,''), avatar_jpeg IS NOT NULL FROM sdl_users WHERE id=$1`, id).Scan(&name, &email, &username, &phone, &hasAvatar)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	write(w, 200, map[string]any{"username": username, "displayName": name, "email": email, "phone": phone, "hasAvatar": hasAvatar})
}
func (s *Service) profileUpdate(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Name  string `json:"displayName"`
		Phone string `json:"phone"`
	}
	if readPayload(r, &p) != nil || !validProfileName(p.Name) || !validProfilePhone(p.Phone) {
		problem(w, 400, "invalid_request")
		return
	}
	id, err := s.currentUser(r)
	if err != nil {
		problem(w, 401, "unauthenticated")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `UPDATE sdl_users SET display_name=$2,profile_phone=$3,updated_at=NOW(),version=version+1 WHERE id=$1`, id, strings.TrimSpace(p.Name), strings.TrimSpace(p.Phone)); err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,'identity.profile_updated','user',$2)`, id, id)
	}
	if err != nil || tx.Commit(ctx) != nil {
		problem(w, 503, "unavailable")
		return
	}
	write(w, 200, map[string]string{"displayName": strings.TrimSpace(p.Name), "phone": strings.TrimSpace(p.Phone)})
}

// avatarJPEG accepts only valid JPEG/PNG and renders a fresh 256px JPEG without metadata.
// Source bitmap dimensions are checked before decoding to bound memory use.
func avatarJPEG(raw []byte) ([]byte, error) {
	if len(raw) == 0 || len(raw) > maxAvatarUpload {
		return nil, errors.New("invalid avatar size")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "jpeg" && format != "png") || cfg.Width < 32 || cfg.Height < 32 || cfg.Width > 4096 || cfg.Height > 4096 || int64(cfg.Width)*int64(cfg.Height) > 12000000 {
		return nil, errors.New("invalid avatar format or dimensions")
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("invalid avatar image")
	}
	bounds := img.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	side := width
	if height < side {
		side = height
	}
	x0 := bounds.Min.X + (width-side)/2
	y0 := bounds.Min.Y + (height-side)/2
	out := image.NewRGBA(image.Rect(0, 0, 256, 256))
	for y := 0; y < 256; y++ {
		for x := 0; x < 256; x++ {
			c := img.At(x0+x*side/256, y0+y*side/256)
			r, g, b, a := c.RGBA()
			// Flatten transparent pixels to white and avoid leaking transparency artifacts.
			r = (r + 0xffff - a)
			g = (g + 0xffff - a)
			b = (b + 0xffff - a)
			if r > 0xffff {
				r = 0xffff
			}
			if g > 0xffff {
				g = 0xffff
			}
			if b > 0xffff {
				b = 0xffff
			}
			out.SetRGBA(x, y, color.RGBA{R: uint8(r >> 8), G: uint8(g >> 8), B: uint8(b >> 8), A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
func (s *Service) profileAvatarUpload(w http.ResponseWriter, r *http.Request) {
	id, err := s.currentUser(r)
	if err != nil {
		problem(w, 401, "unauthenticated")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarUpload+1)
	data, err := io.ReadAll(r.Body)
	if err != nil || len(data) > maxAvatarUpload {
		problem(w, 413, "avatar_too_large")
		return
	}
	jpegBytes, err := avatarJPEG(data)
	if err != nil {
		problem(w, 400, "invalid_avatar")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `UPDATE sdl_users SET avatar_jpeg=$2,updated_at=NOW() WHERE id=$1`, id, jpegBytes)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,'identity.avatar_changed','user',$2)`, id, id)
	}
	if err != nil || tx.Commit(ctx) != nil {
		problem(w, 503, "unavailable")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Service) profileAvatarGet(w http.ResponseWriter, r *http.Request) {
	id, err := s.currentUser(r)
	if err != nil {
		problem(w, 401, "unauthenticated")
		return
	}
	var b []byte
	err = s.db.QueryRow(r.Context(), `SELECT avatar_jpeg FROM sdl_users WHERE id=$1`, id).Scan(&b)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if len(b) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "no-store, private")
	w.WriteHeader(200)
	_, _ = w.Write(b)
}
func (s *Service) profileAvatarDelete(w http.ResponseWriter, r *http.Request) {
	id, err := s.currentUser(r)
	if err != nil {
		problem(w, 401, "unauthenticated")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `UPDATE sdl_users SET avatar_jpeg=NULL,updated_at=NOW() WHERE id=$1`, id)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,'identity.avatar_removed','user',$2)`, id, id)
	}
	if err != nil || tx.Commit(ctx) != nil {
		problem(w, 503, "unavailable")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) emailChangeStart(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if readPayload(r, &p) != nil || !validProfileEmail(p.Email) || len(p.Password) == 0 || len(p.Password) > 256 {
		problem(w, 400, "invalid_request")
		return
	}
	id, err := s.currentUser(r)
	if err != nil {
		problem(w, 401, "unauthenticated")
		return
	}
	if !s.mailer.Ready() {
		problem(w, 503, "smtp_unavailable")
		return
	}
	limitKey := s.signature("profile-email-start", id)
	locked, err := s.locked(r.Context(), []string{limitKey})
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if locked {
		problem(w, 429, "try_later")
		return
	}
	var hash, current string
	err = s.db.QueryRow(r.Context(), `SELECT password_hash,email FROM sdl_users WHERE id=$1 AND is_active=TRUE`, id).Scan(&hash, &current)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if !VerifyPassword(hash, p.Password) {
		s.fail(r.Context(), []string{limitKey})
		problem(w, 401, "invalid_credentials")
		return
	}
	if strings.EqualFold(p.Email, current) {
		problem(w, 400, "same_email")
		return
	}
	var exists bool
	if err = s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_users WHERE lower(email)=lower($1) AND id<>$2)`, p.Email, id).Scan(&exists); err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if exists {
		problem(w, 409, "email_in_use")
		return
	}
	var sent int
	if err = s.db.QueryRow(r.Context(), `SELECT count(*) FROM sdl_profile_email_challenges WHERE user_id=$1 AND created_at>NOW()-INTERVAL '15 minutes'`, id).Scan(&sent); err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if sent >= 3 {
		problem(w, 429, "try_later")
		return
	}
	challenge, err := newRandom(32)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	codeBytes := make([]byte, 4)
	if _, err = rand.Read(codeBytes); err != nil {
		problem(w, 503, "unavailable")
		return
	}
	v := binary.BigEndian.Uint32(codeBytes) % 1000000
	code := fmt.Sprintf("%06d", v)
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `UPDATE sdl_profile_email_challenges SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL`, id)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO sdl_profile_email_challenges(challenge_hash,user_id,new_email,otp_code_hash,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '5 minutes')`, tokenHash(challenge), id, p.Email, s.signature("profile-email-otp", challenge+":"+code))
	}
	if err != nil || tx.Commit(ctx) != nil {
		problem(w, 503, "unavailable")
		return
	}
	if err = s.mailer.SendOTP(r.Context(), p.Email, code); err != nil {
		_, _ = s.db.Exec(context.Background(), `UPDATE sdl_profile_email_challenges SET consumed_at=NOW() WHERE challenge_hash=$1`, tokenHash(challenge))
		problem(w, 503, "smtp_unavailable")
		return
	}
	write(w, 202, map[string]string{"challenge": challenge})
}
func (s *Service) emailChangeVerify(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Challenge string `json:"challenge"`
		Code      string `json:"code"`
	}
	if readPayload(r, &p) != nil || len(p.Challenge) != 43 || len(p.Code) != 6 {
		problem(w, 400, "invalid_request")
		return
	}
	for _, c := range p.Code {
		if c < '0' || c > '9' {
			problem(w, 400, "invalid_request")
			return
		}
	}
	id, err := s.currentUser(r)
	if err != nil {
		problem(w, 401, "unauthenticated")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var address, stored string
	var attempts int
	err = tx.QueryRow(ctx, `SELECT new_email,otp_code_hash,attempts FROM sdl_profile_email_challenges WHERE challenge_hash=$1 AND user_id=$2 AND expires_at>NOW() AND consumed_at IS NULL FOR UPDATE`, tokenHash(p.Challenge), id).Scan(&address, &stored, &attempts)
	if err != nil || attempts >= 5 {
		problem(w, 400, "invalid_or_expired_code")
		return
	}
	expected := s.signature("profile-email-otp", p.Challenge+":"+p.Code)
	if subtle.ConstantTimeCompare([]byte(expected), []byte(stored)) != 1 {
		_, err = tx.Exec(ctx, `UPDATE sdl_profile_email_challenges SET attempts=attempts+1,consumed_at=CASE WHEN attempts>=4 THEN NOW() ELSE consumed_at END WHERE challenge_hash=$1`, tokenHash(p.Challenge))
		if err != nil || tx.Commit(ctx) != nil {
			problem(w, 503, "unavailable")
			return
		}
		problem(w, 400, "invalid_or_expired_code")
		return
	}
	_, err = tx.Exec(ctx, `UPDATE sdl_users SET email=$2,updated_at=NOW(),version=version+1 WHERE id=$1`, id, address)
	if err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23505" {
			problem(w, 409, "email_in_use")
		} else {
			problem(w, 503, "unavailable")
		}
		return
	}
	_, err = tx.Exec(ctx, `UPDATE sdl_profile_email_challenges SET consumed_at=NOW() WHERE challenge_hash=$1`, tokenHash(p.Challenge))
	if err == nil {
		c, _ := r.Cookie(sessionCookie)
		_, err = tx.Exec(ctx, `UPDATE sdl_sessions SET revoked_at=NOW() WHERE user_id=$1 AND token_hash<>$2 AND revoked_at IS NULL`, id, tokenHash(c.Value))
	}
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,'identity.email_changed','user',$2)`, id, id)
	}
	if err != nil || tx.Commit(ctx) != nil {
		problem(w, 503, "unavailable")
		return
	}
	write(w, 200, map[string]string{"email": address})
}
