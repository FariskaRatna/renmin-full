package notifications

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"

	"siera-delta-lima/backend/internal/auth"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// R5F22 intentionally uses a separate queue: disposition-task outbox semantics
// and existing messages remain untouched. No mail body or address is stored.
type intakeJob struct {
	ID, RecipientID string
	Attempts        int
}

func intakeMailMessage() (string, string) {
	return "Surat Masuk Baru - SIERA DELTA LIMA",
		"Ada Surat Masuk baru yang memerlukan arahan atau disposisi Anda. " +
			"Silakan login, kemudian buka URMIN > Surat Masuk > Inbox."
}

func claimIntake(ctx context.Context, db *pgxpool.Pool) (intakeJob, bool, error) {
	// Recover expired leases; never retry past the six-attempt limit.
	if _, err := db.Exec(ctx, `UPDATE sdl_urmin_intake_mail_outbox
        SET status='failed',lease_until=NULL,error_code='delivery_interrupted'
        WHERE status='sending' AND attempts>=6 AND lease_until<now()`); err != nil {
		return intakeJob{}, false, err
	}
	var j intakeJob
	err := db.QueryRow(ctx, `WITH candidate AS (
        SELECT n.id FROM sdl_urmin_intake_mail_outbox n
        JOIN sdl_urmin_distributions d
          ON d.id=n.distribution_id AND d.recipient_user=n.recipient_user
             AND d.recipient_unit='urmin'
        WHERE n.attempts<6 AND
          ((n.status='queued' AND n.available_at<=now())
          OR (n.status='sending' AND n.lease_until<now()))
        ORDER BY n.created_at,n.id
        FOR UPDATE OF n SKIP LOCKED LIMIT 1
    ) UPDATE sdl_urmin_intake_mail_outbox n
        SET status='sending',attempts=n.attempts+1,
            lease_until=now()+interval '90 seconds',error_code=NULL
        FROM candidate c WHERE n.id=c.id
        RETURNING n.id::text,n.recipient_user::text,n.attempts`).Scan(&j.ID, &j.RecipientID, &j.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return intakeJob{}, false, nil
	}
	return j, err == nil, err
}

func deliverIntakeOne(ctx context.Context, db *pgxpool.Pool, sender auth.Mailer) error {
	j, found, err := claimIntake(ctx, db)
	if err != nil || !found {
		return err
	}
	var addr string
	var active, passwordReady bool
	err = db.QueryRow(ctx, `SELECT email,is_active,NOT must_change_password
        FROM sdl_users WHERE id=$1::uuid`, j.RecipientID).Scan(&addr, &active, &passwordReady)
	if err != nil {
		return retryIntake(ctx, db, j, "lookup_failed", false)
	}
	parsed, parseErr := mail.ParseAddress(addr)
	if !active || !passwordReady || parseErr != nil || parsed.Address != addr ||
		strings.HasSuffix(strings.ToLower(addr), ".invalid") || strings.ContainsAny(addr, "\r\n\x00") {
		return retryIntake(ctx, db, j, "recipient_unavailable", true)
	}
	subject, body := intakeMailMessage()
	sendCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	sendErr := sender.SendNotification(sendCtx, addr, subject, body)
	cancel()
	if sendErr != nil {
		return retryIntake(ctx, db, j, "smtp_delivery_failed", false)
	}
	_, err = db.Exec(ctx, `UPDATE sdl_urmin_intake_mail_outbox
        SET status='sent',sent_at=now(),lease_until=NULL,error_code=NULL
        WHERE id=$1::uuid AND status='sending'`, j.ID)
	return err
}

func retryIntake(ctx context.Context, db *pgxpool.Pool, j intakeJob, code string, permanent bool) error {
	if permanent || j.Attempts >= 6 {
		_, err := db.Exec(ctx, `UPDATE sdl_urmin_intake_mail_outbox
            SET status='failed',lease_until=NULL,error_code=$2
            WHERE id=$1::uuid`, j.ID, code)
		return err
	}
	delay := []int{1, 2, 5, 10, 20, 30}[j.Attempts-1]
	_, err := db.Exec(ctx, `UPDATE sdl_urmin_intake_mail_outbox
        SET status='queued',lease_until=NULL,
            available_at=now()+($2::int * interval '1 minute'),error_code=$3
        WHERE id=$1::uuid`, j.ID, delay, code)
	return err
}
