package auth

import (
 "context"
 "testing"
)

func TestNotificationInputFailClosed(t *testing.T) {
 m:=Mailer{}
 if err:=m.SendNotification(context.Background(),"test@example.com","Subject","Body"); err==nil { t.Fatal("unconfigured SMTP must reject") }
}
