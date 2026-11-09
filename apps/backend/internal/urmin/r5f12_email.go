package urmin

import (
	"context"
	"github.com/jackc/pgx/v5"
)

// enqueueUrminEmail records a notification in the same transaction as its
// authorization-checked state change. It never stores email addresses or
// message content, and cannot create events for another unit.
func enqueueUrminEmail(ctx context.Context, tx pgx.Tx, taskID, recipientID, event string) error {
	_, err := tx.Exec(ctx, `INSERT INTO sdl_urmin_email_outbox(task_id,recipient_user,event_key)
        SELECT t.id,$2::uuid,$3 FROM sdl_urmin_disposition_tasks t
        WHERE t.id=$1::uuid AND t.unit_key='urmin'
        ON CONFLICT(task_id,recipient_user,event_key) DO NOTHING`, taskID, recipientID, event)
	return err
}
