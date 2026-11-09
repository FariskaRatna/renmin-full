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

type Mailer struct {
	Host                     string
	Port                     int
	Username, Password, From string
}

func (m Mailer) Ready() bool {
	if m.Host == "" || (m.Port != 465 && m.Port != 587) || m.Username == "" || m.Password == "" || m.From == "" {
		return false
	}
	addr, err := mail.ParseAddress(m.From)
	return err == nil && addr.Address == m.From && !strings.ContainsAny(m.From, "\r\n")
}

// SMTP is TLS-only; OTP is never printed or sent over unauthenticated plaintext SMTP.
func (m Mailer) SendOTP(ctx context.Context, destination, code string) error {
	if !m.Ready() {
		return errors.New("smtp not configured")
	}
	parsed, err := mail.ParseAddress(destination)
	if err != nil || parsed.Address != destination {
		return errors.New("invalid email")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	target := net.JoinHostPort(m.Host, strconv.Itoa(m.Port))
	dialer := net.Dialer{Timeout: 7 * time.Second}
	var conn net.Conn
	if m.Port == 465 {
		conn, err = tls.DialWithDialer(&dialer, "tcp", target, &tls.Config{ServerName: m.Host, MinVersion: tls.VersionTLS12})
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", target)
	}
	if err != nil {
		return err
	}
	defer conn.Close()
	client, err := smtp.NewClient(conn, m.Host)
	if err != nil {
		return err
	}
	defer client.Close()
	if m.Port == 587 {
		ok, _ := client.Extension("STARTTLS")
		if !ok {
			return errors.New("smtp server does not support STARTTLS")
		}
		if err = client.StartTLS(&tls.Config{ServerName: m.Host, MinVersion: tls.VersionTLS12}); err != nil {
			return err
		}
	}
	if ok, _ := client.Extension("AUTH"); !ok {
		return errors.New("smtp AUTH unavailable")
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
	wc, err := client.Data()
	if err != nil {
		return err
	}
	message, err := buildOTPEmail(m.From, destination, code)
	if err != nil {
		_ = wc.Close()
		return err
	}
	if _, err = wc.Write([]byte(message)); err != nil {
		_ = wc.Close()
		return err
	}
	if err = wc.Close(); err != nil {
		return err
	}
	return client.Quit()
}
