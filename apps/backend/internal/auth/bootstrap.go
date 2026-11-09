package auth

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/mail"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

var validUsername = regexp.MustCompile(`^[a-z][a-z0-9._-]{2,63}$`)

// BootstrapSuperadmin reads four newline-separated values from stdin; no CLI password arguments.
// It only operates on an entirely empty user table, in one transaction.
func BootstrapSuperadmin(ctx context.Context, db *pgxpool.Pool, source io.Reader) error {
	reader := bufio.NewReader(io.LimitReader(source, 4096))
	values := make([]string, 4)
	for i := range values {
		s, err := reader.ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return err
		}
		values[i] = strings.TrimSuffix(strings.TrimSuffix(s, "\n"), "\r")
		if i < 3 {
			values[i] = strings.TrimSpace(values[i])
		}
		if err == io.EOF && i != 3 {
			return errors.New("missing bootstrap input")
		}
	}
	username, email, name, password := values[0], values[1], values[2], values[3]
	address, err := mail.ParseAddress(email)
	if !validUsername.MatchString(username) || err != nil || address.Address != email || len(name) < 3 || len(name) > 160 || strings.ContainsAny(name, "\r\n") {
		return errors.New("invalid bootstrap identity")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(20261018)"); err != nil {
		return err
	}
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM sdl_users)").Scan(&exists); err != nil {
		return err
	}
	if exists {
		return errors.New("bootstrap denied: user table is not empty")
	}
	var userID string
	if err = tx.QueryRow(ctx, `INSERT INTO sdl_users(username,email,display_name,password_hash,is_active,otp_required) VALUES($1,$2,$3,$4,TRUE,TRUE) RETURNING id::text`, username, email, name, hash).Scan(&userID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO sdl_user_roles(user_id,role_key) VALUES($1,'superadmin')", userID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,'identity.superadmin.bootstrapped','user',$2)", userID, userID); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	fmt.Println("STATUS: Superadmin created. OTP email is mandatory; configure SMTP before login.")
	return nil
}
