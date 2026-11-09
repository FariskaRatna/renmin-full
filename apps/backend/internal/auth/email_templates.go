package auth

import (
	"bytes"
	"errors"
	"fmt"
	"html"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"regexp"
	"strings"
	"time"
)

// These templates intentionally use no externally hosted images, fonts or
// trackers. Sensitive document titles, attachments and instructions are never
// included in URMIN notification messages.
var otpFormat = regexp.MustCompile(`^[0-9]{6}$`)

func emailShell(preheader, heading, inner string) string {
	// Table layout and inline CSS work in common desktop and mobile clients.
	return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>` +
		`<body style="margin:0;padding:0;background:#f3f5f8;color:#17273c;font-family:Arial,Helvetica,sans-serif">` +
		`<div style="display:none;max-height:0;overflow:hidden;opacity:0">` + html.EscapeString(preheader) + `</div>` +
		`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f5f8"><tr><td align="center" style="padding:28px 14px">` +
		`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e0e6ec;border-radius:14px;overflow:hidden">` +
		`<tr><td style="padding:25px 30px;background:#142940;color:#ffffff"><div style="font-size:17px;font-weight:700;letter-spacing:.5px">SIERA DELTA LIMA</div>` +
		`<div style="font-size:12px;line-height:1.6;color:#c8d8e8;margin-top:5px">BagRenmin Densus 88 AT Polri</div></td></tr>` +
		`<tr><td style="padding:32px 30px"><div style="font-size:12px;font-weight:700;letter-spacing:.8px;color:#3d687d;text-transform:uppercase">NOTIFIKASI SISTEM</div>` +
		`<h1 style="font-size:24px;line-height:1.3;letter-spacing:-.35px;margin:12px 0 18px;color:#17273c">` + html.EscapeString(heading) + `</h1>` +
		inner + `</td></tr>` +
		`<tr><td style="padding:22px 30px;background:#f7f9fb;border-top:1px solid #e5eaf0">` +
		`<div style="font-size:12px;line-height:1.7;color:#64748b">Email otomatis dari SIERA DELTA LIMA. Jangan balas email ini.</div>` +
		`<div style="font-size:11px;line-height:1.6;color:#8190a0;margin-top:5px">BagRenmin Densus 88 AT Polri</div></td></tr>` +
		`</table></td></tr></table></body></html>`
}

func emailParagraph(text string) string {
	return `<p style="margin:0 0 18px;font-size:15px;line-height:1.75;color:#34465b">` +
		strings.ReplaceAll(html.EscapeString(text), "\n", "<br>") + `</p>`
}

func buildOTPEmail(from, to, code string) (string, error) {
	if !otpFormat.MatchString(code) {
		return "", errors.New("otp_format_invalid")
	}
	plain := "Kode verifikasi SIERA DELTA LIMA\n\nKode OTP Anda: " + code +
		"\nBerlaku 5 menit. Jangan bagikan kode ini kepada siapa pun.\n\n" +
		"Jika Anda tidak meminta kode ini, abaikan email.\n\nBagRenmin Densus 88 AT Polri"
	detail := emailParagraph("Gunakan kode berikut untuk melanjutkan verifikasi akun Anda.") +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f5f8;border:1px solid #dbe5ec;border-radius:10px"><tr>` +
		`<td align="center" style="padding:20px 12px"><div style="font-size:34px;letter-spacing:8px;font-weight:700;color:#173953;font-family:Arial,Helvetica,sans-serif">` + code + `</div>` +
		`<div style="font-size:12px;color:#5b7284;margin-top:10px">Berlaku selama 5 menit</div></td></tr></table>` +
		`<p style="margin:20px 0 0;font-size:13px;line-height:1.7;color:#607184">Jangan bagikan kode ini kepada siapa pun. Jika Anda tidak meminta kode, abaikan email ini.</p>`
	return buildMultipartEmail(from, to, "Kode Verifikasi - SIERA DELTA LIMA", plain,
		emailShell("Kode verifikasi akun Anda berlaku 5 menit.", "Kode Verifikasi", detail))
}

func buildNotificationEmail(from, to, subject, body string) (string, error) {
	heading := strings.TrimSuffix(subject, " - SIERA DELTA LIMA")
	if heading == "" {
		heading = "Pemberitahuan Tugas"
	}
	// R5F22: incoming letters direct Kabagrenmin to Inbox, not task disposition.
	navigationPlain := "URMIN > Disposisi"
	navigationHTML := "URMIN &rsaquo; Disposisi"
	if subject == "Surat Masuk Baru - SIERA DELTA LIMA" {
		navigationPlain = "URMIN > Surat Masuk > Inbox"
		navigationHTML = "URMIN &rsaquo; Surat Masuk &rsaquo; Inbox"
	}
	plain := "SIERA DELTA LIMA — BagRenmin Densus 88 AT Polri\n\n" + heading + "\n\n" +
		body + "\n\nBuka aplikasi SIERA DELTA LIMA > " + navigationPlain + " untuk melihat pekerjaan Anda." +
		"\nDokumen dan rincian tugas hanya tersedia setelah login dan sesuai kewenangan akun Anda.\n\n" +
		"Email otomatis. Jangan balas email ini."
	detail := emailParagraph(body) +
		`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #dbe5ec;background:#f2f6f9;border-radius:10px"><tr><td style="padding:17px 18px">` +
		`<div style="font-size:12px;color:#547089;font-weight:700;margin-bottom:5px">BUKA PEKERJAAN</div>` +
		`<div style="font-size:15px;color:#173953;font-weight:700">SIERA DELTA LIMA &rsaquo; ` + navigationHTML + `</div></td></tr></table>` +
		`<p style="font-size:12px;line-height:1.7;color:#64748b;margin:20px 0 0">` +
		`Untuk keamanan, detail pekerjaan dan lampiran hanya tersedia setelah login sesuai kewenangan Anda.</p>`
	return buildMultipartEmail(from, to, subject, plain,
		emailShell(body, heading, detail))
}

func buildMultipartEmail(from, to, subject, plain, htmlBody string) (string, error) {
	// Only constant subjects and validated account addresses enter this helper.
	if strings.ContainsAny(from+to+subject, "\r\n\x00") || !validEnvelopeEmail(from) || !validEnvelopeEmail(to) ||
		subject == "" || len(subject) > 120 || strings.ContainsAny(plain, "\x00") ||
		strings.ContainsAny(htmlBody, "\x00") {
		return "", errors.New("email_template_invalid")
	}
	var content bytes.Buffer
	writer := multipart.NewWriter(&content)
	addPart := func(contentType, data string) error {
		headers := map[string][]string{
			"Content-Type":              {contentType},
			"Content-Transfer-Encoding": {"quoted-printable"},
		}
		part, err := writer.CreatePart(headers)
		if err != nil {
			return err
		}
		encoder := quotedprintable.NewWriter(part)
		// Keep text LF-normalized; quoted-printable writer uses CRLF on the wire.
		if _, err := encoder.Write([]byte(strings.ReplaceAll(data, "\r\n", "\n"))); err != nil {
			_ = encoder.Close()
			return err
		}
		return encoder.Close()
	}
	if err := addPart("text/plain; charset=UTF-8", plain); err != nil {
		return "", err
	}
	if err := addPart("text/html; charset=UTF-8", htmlBody); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	// Display label is distinct from the authenticated SMTP envelope address.
	senderHeader := (&mail.Address{Name: "No-Reply Siera Delta Lima", Address: from}).String()
	header := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=%q\r\nAuto-Submitted: auto-generated\r\n\r\n",
		senderHeader, to, subject, time.Now().UTC().Format(time.RFC1123Z), writer.Boundary())
	return header + content.String(), nil
}

func validEnvelopeEmail(value string) bool {
	addr, err := mail.ParseAddress(value)
	return err == nil && addr.Address == value && !strings.ContainsAny(value, "\r\n\x00")
}
