// Package notifications delivers URMIN email notifications from a durable
// transactional outbox. Mail delivery is best effort and never grants access.
package notifications

import (
	"context"
	"errors"
	"log/slog"
	"net/mail"
	"siera-delta-lima/backend/internal/auth"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type job struct {
	ID, RecipientID, Event string
	Attempts               int
}

// Run blocks until shutdown. A single worker polls every 10s; multiple API
// replicas coordinate through row locks and expiring claims.
func Run(ctx context.Context, db *pgxpool.Pool, sender auth.Mailer, log *slog.Logger) {
	if !sender.Ready() {
		log.Info("urmin email notification worker inactive", "reason", "smtp_not_configured")
		return
	}
	log.Info("urmin email notification worker enabled")
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		if err := deliverOne(ctx, db, sender); err != nil && ctx.Err() == nil {
			// Never log recipient, SMTP secrets, task subject, or email body.
			log.Warn("urmin email notification worker attempt failed", "kind", "delivery_or_database")
		}
		if err := deliverIntakeOne(ctx, db, sender); err != nil && ctx.Err() == nil {
			// Generic event only; never log letter content, identity or addresses.
			log.Warn("urmin intake email worker attempt failed", "kind", "delivery_or_database")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func claim(ctx context.Context, db *pgxpool.Pool) (job, bool, error) {
	// Recover an interrupted final attempt without retrying indefinitely.
	if _, err := db.Exec(ctx, `UPDATE sdl_urmin_email_outbox
	  SET status='failed',lease_until=NULL,error_code='delivery_interrupted'
	  WHERE status='sending' AND attempts>=6 AND lease_until<now()`); err != nil {
		return job{}, false, err
	}
	var j job
	err := db.QueryRow(ctx, `WITH candidate AS (
      SELECT n.id FROM sdl_urmin_email_outbox n
      JOIN sdl_urmin_disposition_tasks t ON t.id=n.task_id
      WHERE t.unit_key='urmin' AND n.attempts<6 AND
       ((n.status='queued' AND n.available_at<=now()) OR (n.status='sending' AND n.lease_until<now()))
      ORDER BY n.created_at,n.id FOR UPDATE OF n SKIP LOCKED LIMIT 1
    ) UPDATE sdl_urmin_email_outbox n SET status='sending',attempts=attempts+1,
      lease_until=now()+interval '90 seconds',error_code=NULL
      FROM candidate c WHERE n.id=c.id
      RETURNING n.id::text,n.recipient_user::text,n.event_key,n.attempts`).Scan(&j.ID, &j.RecipientID, &j.Event, &j.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return job{}, false, nil
	}
	return j, err == nil, err
}

func message(event string) (string, string, bool) {
	switch event {
	case "assigned":
		return "Tugas Baru - SIERA DELTA LIMA", "Anda menerima penugasan disposisi baru.", true
	case "forwarded":
		return "Tugas Diteruskan - SIERA DELTA LIMA", "Ada penugasan disposisi yang diteruskan kepada Anda.", true
	case "completed":
		return "Tugas Selesai - SIERA DELTA LIMA", "Hasil pekerjaan telah disampaikan dan menunggu pemeriksaan Anda.", true
	case "review_approved":
		return "Hasil Disetujui - SIERA DELTA LIMA", "Hasil pekerjaan Anda telah disetujui.", true
	case "review_revision":
		return "Perlu Perbaikan - SIERA DELTA LIMA", "Hasil pekerjaan Anda memerlukan tindak lanjut. Periksa catatan pemeriksaan di aplikasi.", true
	default:
		return "", "", false
	}
}

func deliverOne(ctx context.Context, db *pgxpool.Pool, sender auth.Mailer) error {
	j, ok, err := claim(ctx, db)
	if err != nil || !ok {
		return err
	}
	var destination string
	var active bool
	err = db.QueryRow(ctx, `SELECT email,is_active FROM sdl_users WHERE id=$1`, j.RecipientID).Scan(&destination, &active)
	if err != nil {
		return retry(ctx, db, j, "lookup_failed", false)
	}
	addr, parseErr := mail.ParseAddress(destination)
	if !active || parseErr != nil || addr.Address != destination || strings.HasSuffix(strings.ToLower(destination), ".invalid") || strings.ContainsAny(destination, "\r\n") {
		return retry(ctx, db, j, "recipient_unavailable", true)
	}
	title, body, valid := message(j.Event)
	if !valid {
		return retry(ctx, db, j, "event_invalid", true)
	}
	sendCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	sendErr := sender.SendNotification(sendCtx, destination, title, body)
	cancel()
	if sendErr != nil {
		return retry(ctx, db, j, "smtp_delivery_failed", false)
	}
	_, err = db.Exec(ctx, `UPDATE sdl_urmin_email_outbox SET status='sent',sent_at=now(),lease_until=NULL,error_code=NULL
      WHERE id=$1 AND status='sending'`, j.ID)
	return err
}

func retry(ctx context.Context, db *pgxpool.Pool, j job, code string, permanent bool) error {
	if permanent || j.Attempts >= 6 {
		_, err := db.Exec(ctx, `UPDATE sdl_urmin_email_outbox SET status='failed',lease_until=NULL,error_code=$2 WHERE id=$1`, j.ID, code)
		return err
	}
	delay := []int{1, 2, 5, 10, 20, 30}[j.Attempts-1]
	_, err := db.Exec(ctx, `UPDATE sdl_urmin_email_outbox SET status='queued',lease_until=NULL,
        available_at=now()+($2::int * interval '1 minute'),error_code=$3 WHERE id=$1`, j.ID, delay, code)
	return err
}
