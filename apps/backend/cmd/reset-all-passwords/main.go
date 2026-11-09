// This utility is intended only for the existing isolated local SDL development database.
// Run via scripts/reset-all-passwords.sh, never by a public HTTP endpoint.
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"siera-delta-lima/backend/internal/auth"
)

func readInput(r io.Reader) (int, string, error) {
	reader := bufio.NewReader(io.LimitReader(r, 1024))
	line1, err := reader.ReadString('\n')
	if err != nil {
		return 0, "", errors.New("missing expected user count")
	}
	line2, err := reader.ReadString('\n')
	if err != nil {
		return 0, "", errors.New("missing temporary password")
	}
	if _, err := reader.ReadByte(); err != io.EOF {
		return 0, "", errors.New("unexpected extra input")
	}
	count, err := strconv.Atoi(strings.TrimSpace(line1))
	if err != nil || count < 1 || count > 5000 {
		return 0, "", errors.New("invalid expected user count")
	}
	password := strings.TrimSuffix(line2, "\n")
	if len(password) < 14 || len(password) > 256 || strings.ContainsAny(password, "\r\n\x00") {
		return 0, "", errors.New("temporary password violates application policy")
	}
	return count, password, nil
}

func apply(ctx context.Context, pool *pgxpool.Pool, expected int, password string) (int, error) {
	if os.Getenv("SDL_ENV") != "development" {
		return 0, errors.New("REFUSED: not a development environment")
	}
	cctx, cancel := context.WithTimeout(ctx, 6*time.Minute)
	defer cancel()
	tx, err := pool.BeginTx(cctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(cctx)
	var name string
	if err := tx.QueryRow(cctx, "SELECT current_database()").Scan(&name); err != nil {
		return 0, err
	}
	if name != "sdl_root_dev" {
		return 0, errors.New("REFUSED: unexpected database")
	}
	if _, err := tx.Exec(cctx, "SELECT pg_advisory_xact_lock(20261021, 51)"); err != nil {
		return 0, err
	}
	rows, err := tx.Query(cctx, `SELECT id::text, username FROM sdl_users ORDER BY username FOR UPDATE`)
	if err != nil {
		return 0, err
	}
	type target struct{ id, username string }
	users := make([]target, 0, expected)
	for rows.Next() {
		var u target
		if err := rows.Scan(&u.id, &u.username); err != nil {
			rows.Close()
			return 0, err
		}
		users = append(users, u)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	if len(users) != expected {
		return 0, fmt.Errorf("account count changed since CLI confirmation: expected %d, now %d", expected, len(users))
	}
	var admins int
	if err := tx.QueryRow(cctx, `SELECT count(DISTINCT ur.user_id) FROM sdl_user_roles ur JOIN sdl_users u ON u.id=ur.user_id WHERE ur.role_key='superadmin'`).Scan(&admins); err != nil {
		return 0, err
	}
	if admins < 1 {
		return 0, errors.New("REFUSED: no Superadmin found")
	}
	// Per-user Argon2id hashes with independent salts, exactly as required by SDL auth.
	for _, u := range users {
		hash, err := auth.HashPassword(password)
		if err != nil {
			return 0, err
		}
		tag, err := tx.Exec(cctx, `UPDATE sdl_users SET password_hash=$2,must_change_password=TRUE,password_changed_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1::uuid`, u.id, hash)
		if err != nil {
			return 0, err
		}
		if tag.RowsAffected() != 1 {
			return 0, errors.New("unexpected affected rows")
		}
		_, err = tx.Exec(cctx, `INSERT INTO sdl_audit_events(event_key,subject_type,subject_id,metadata) VALUES('identity.password_reset_bulk','user',$1,jsonb_build_object('source','local_development_cli','force_change',true))`, u.id)
		if err != nil {
			return 0, err
		}
	}
	if _, err := tx.Exec(cctx, `UPDATE sdl_sessions SET revoked_at=NOW() WHERE revoked_at IS NULL`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(cctx, `UPDATE sdl_login_challenges SET consumed_at=NOW() WHERE consumed_at IS NULL`); err != nil {
		return 0, err
	}
	if err := tx.Commit(cctx); err != nil {
		return 0, err
	}
	return len(users), nil
}

func main() {
	if len(os.Args) != 2 || os.Args[1] != "-apply" {
		fmt.Fprintln(os.Stderr, "REFUSED: requires -apply via local interactive wrapper")
		os.Exit(2)
	}
	expected, password, err := readInput(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "REFUSED:", err)
		os.Exit(2)
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		fmt.Fprintln(os.Stderr, "REFUSED: missing database connection")
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR: cannot connect to database")
		os.Exit(1)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "ERROR: database unavailable")
		os.Exit(1)
	}
	changed, err := apply(ctx, pool, expected, password)
	if err != nil {
		// Never expose connection strings, SQL parameters, or the password.
		fmt.Fprintln(os.Stderr, "ERROR: password reset transaction rolled back:", err)
		os.Exit(1)
	}
	fmt.Printf("SUCCESS: %d user password hashes rotated atomically; force-change enabled; sessions and OTP challenges revoked.\n", changed)
}
