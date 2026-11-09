package auth

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// SendNotification sends a simple generic message with SMTP TLS (465/587).
// No task contents or attachments are passed to this function.
func (m Mailer) SendNotification(ctx context.Context, destination, subject, body string) error {
	if !m.Ready() {
		return errors.New("smtp_not_configured")
	}
	parsed, err := mail.ParseAddress(destination)
	if err != nil || parsed.Address != destination || strings.ContainsAny(destination, "\r\n") {
		return errors.New("recipient_invalid")
	}
	if len(subject) == 0 || len(subject) > 120 || strings.ContainsAny(subject, "\r\n") ||
		len(body) == 0 || len(body) > 1500 || strings.ContainsAny(body, "\r\x00") {
		return errors.New("message_invalid")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	target := net.JoinHostPort(m.Host, strconv.Itoa(m.Port))
	dialer := &net.Dialer{Timeout: 7 * time.Second}
	var conn net.Conn
	if m.Port == 465 {
		conn, err = tls.DialWithDialer(dialer, "tcp", target, &tls.Config{ServerName: m.Host, MinVersion: tls.VersionTLS12})
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", target)
	}
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(14 * time.Second))
	client, err := smtp.NewClient(conn, m.Host)
	if err != nil {
		return err
	}
	defer client.Close()
	if m.Port == 587 {
		supported, _ := client.Extension("STARTTLS")
		if !supported {
			return errors.New("starttls_unavailable")
		}
		if err = client.StartTLS(&tls.Config{ServerName: m.Host, MinVersion: tls.VersionTLS12}); err != nil {
			return err
		}
	}
	if supported, _ := client.Extension("AUTH"); !supported {
		return errors.New("smtp_auth_unavailable")
	}
	if err = client.Auth(smtp.PlainAuth("", m.Username, m.Password, m.Host)); err != nil {
		return err
	}
	if err = client.Mail(m.From); err != nil {
		return err
	}
	if err = client.Rcpt(destination); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	// Subject and body are constant-string content selected by the worker.
	message, renderErr := buildNotificationEmail(m.From, destination, subject, body)
	if renderErr != nil {
		_ = writer.Close()
		return renderErr
	}
	if _, err = writer.Write([]byte(message)); err != nil {
		_ = writer.Close()
		return err
	}
	if err = writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}
