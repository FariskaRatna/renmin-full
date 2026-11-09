import nodemailer from 'nodemailer'

/**
 * Pengiriman OTP lewat SMTP, padanan internal/auth/smtp.go.
 *
 * Aturan yang dipertahankan apa adanya:
 *   - TLS wajib. Port 465 = TLS langsung, 587 = STARTTLS. Port lain ditolak.
 *   - Kode OTP TIDAK PERNAH dicetak ke log, dan tidak ada fallback dev.
 *   - Ready() menuntut kelima field terisi dan From berupa alamat yang sah.
 *
 * Konsekuensi yang perlu diingat: OTP Superadmin tidak bisa dimatikan, jadi
 * SMTP yang tidak dikonfigurasi membuat Superadmin tidak bisa login sama sekali
 * (503 email_delivery_unavailable).
 */

const ADDRESS_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

function validAddress(value) {
  return typeof value === 'string' && !/[\r\n]/.test(value) && ADDRESS_PATTERN.test(value)
}

export class Mailer {
  #config

  constructor(smtpConfig) {
    this.#config = smtpConfig
  }

  /** Padanan Mailer.Ready (smtp.go:21). */
  ready() {
    const { host, port, username, password, from } = this.#config
    if (!host || (port !== 465 && port !== 587) || !username || !password || !from) return false
    return validAddress(from)
  }

  /** Transport sekali pakai. TLS wajib; port di luar 465/587 sudah ditolak ready(). */
  #transport() {
    return nodemailer.createTransport({
      host: this.#config.host,
      port: this.#config.port,
      secure: this.#config.port === 465,
      requireTLS: this.#config.port === 587,
      auth: { user: this.#config.username, pass: this.#config.password },
      tls: { minVersion: 'TLSv1.2', servername: this.#config.host },
      connectionTimeout: 7000,
      greetingTimeout: 7000,
      socketTimeout: 10000,
    })
  }

  /** Padanan Mailer.SendOTP. Melempar kalau gagal; pemanggil yang memetakan ke 503. */
  async sendOtp(destination, code) {
    if (!this.ready()) throw new Error('smtp not configured')
    if (!validAddress(destination)) throw new Error('invalid email')
    if (!/^[0-9]{6}$/.test(code)) throw new Error('otp_format_invalid')

    const transport = this.#transport()
    try {
      await transport.sendMail({
        from: `"No-Reply Siera Delta Lima" <${this.#config.from}>`,
        to: destination,
        subject: 'Kode Verifikasi - SIERA DELTA LIMA',
        text: buildOtpPlainText(code),
        html: buildOtpHtml(code),
      })
    } finally {
      transport.close()
    }
  }

  /**
   * Padanan Mailer.SendNotification (notification_smtp.go:17).
   *
   * Pemanggilnya hanya worker outbox, dan subjek maupun badan pesannya SELALU
   * string konstan yang dipilih `message()` — tidak pernah isi tugas, nama
   * dokumen, maupun lampiran. Validasi panjang di bawah tetap disalin apa
   * adanya: ia penjaga terakhir kalau suatu saat ada pemanggil baru.
   */
  async sendNotification(destination, subject, body) {
    if (!this.ready()) throw new Error('smtp_not_configured')
    if (!validAddress(destination)) throw new Error('recipient_invalid')
    // Perhatikan asimetrinya, disalin dari Go: subjek menolak CR dan LF,
    // badan pesan hanya menolak CR dan NUL — LF di badan justru sah karena
    // teks polosnya memang berbaris banyak.
    if (
      subject.length === 0 || subject.length > 120 || /[\r\n]/.test(subject) ||
      body.length === 0 || body.length > 1500 || /[\r\0]/.test(body)
    ) {
      throw new Error('message_invalid')
    }

    const transport = this.#transport()
    try {
      await transport.sendMail({
        from: `"No-Reply Siera Delta Lima" <${this.#config.from}>`,
        to: destination,
        subject,
        text: buildNotificationPlainText(subject, body),
        html: buildNotificationHtml(subject, body),
        headers: { 'Auto-Submitted': 'auto-generated' },
      })
    } finally {
      transport.close()
    }
  }
}

/** Padanan html.EscapeString Go — lima karakter, `&` harus lebih dulu. */
function htmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&#34;')
}

/**
 * Judul dan arah navigasi diturunkan DARI SUBJEK (email_templates.go:60).
 *
 * Satu subjek diperlakukan khusus: surat masuk mengarahkan penerimanya ke
 * Inbox, bukan ke daftar disposisi — R5F22. Sisanya selalu ke Disposisi.
 */
function notificationLabels(subject) {
  let heading = subject.endsWith(' - SIERA DELTA LIMA')
    ? subject.slice(0, -' - SIERA DELTA LIMA'.length)
    : subject
  if (heading === '') heading = 'Pemberitahuan Tugas'

  if (subject === 'Surat Masuk Baru - SIERA DELTA LIMA') {
    return { heading, navigationPlain: 'URMIN > Surat Masuk > Inbox', navigationHtml: 'URMIN &rsaquo; Surat Masuk &rsaquo; Inbox' }
  }
  return { heading, navigationPlain: 'URMIN > Disposisi', navigationHtml: 'URMIN &rsaquo; Disposisi' }
}

/** Teks polos disalin PERSIS dari buildNotificationEmail. Perhatikan em-dash-nya. */
export function buildNotificationPlainText(subject, body) {
  const { heading, navigationPlain } = notificationLabels(subject)
  return (
    'SIERA DELTA LIMA — BagRenmin Densus 88 AT Polri\n\n' + heading + '\n\n' +
    body + '\n\nBuka aplikasi SIERA DELTA LIMA > ' + navigationPlain + ' untuk melihat pekerjaan Anda.' +
    '\nDokumen dan rincian tugas hanya tersedia setelah login dan sesuai kewenangan akun Anda.\n\n' +
    'Email otomatis. Jangan balas email ini.'
  )
}

/**
 * Padanan emailShell + emailParagraph + blok detail.
 *
 * Berbeda dari HTML OTP yang disusun ulang bebas (D2), yang satu ini disalin
 * string per string sehingga byte-nya identik dengan keluaran Go — semua
 * nilainya konstan dan tidak ada yang perlu di-escape pada praktiknya.
 * Amplop MIME-nya tetap berbeda karena dirakit nodemailer; itu bagian D2 yang
 * memang diterima.
 */
export function buildNotificationHtml(subject, body) {
  const { heading, navigationHtml } = notificationLabels(subject)
  const detail =
    `<p style="margin:0 0 18px;font-size:15px;line-height:1.75;color:#34465b">` +
    htmlEscape(body).replaceAll('\n', '<br>') + `</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #dbe5ec;background:#f2f6f9;border-radius:10px"><tr><td style="padding:17px 18px">` +
    `<div style="font-size:12px;color:#547089;font-weight:700;margin-bottom:5px">BUKA PEKERJAAN</div>` +
    `<div style="font-size:15px;color:#173953;font-weight:700">SIERA DELTA LIMA &rsaquo; ` + navigationHtml + `</div></td></tr></table>` +
    `<p style="font-size:12px;line-height:1.7;color:#64748b;margin:20px 0 0">` +
    `Untuk keamanan, detail pekerjaan dan lampiran hanya tersedia setelah login sesuai kewenangan Anda.</p>`

  return (
    `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#f3f5f8;color:#17273c;font-family:Arial,Helvetica,sans-serif">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">` + htmlEscape(body) + `</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f5f8"><tr><td align="center" style="padding:28px 14px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e0e6ec;border-radius:14px;overflow:hidden">` +
    `<tr><td style="padding:25px 30px;background:#142940;color:#ffffff"><div style="font-size:17px;font-weight:700;letter-spacing:.5px">SIERA DELTA LIMA</div>` +
    `<div style="font-size:12px;line-height:1.6;color:#c8d8e8;margin-top:5px">BagRenmin Densus 88 AT Polri</div></td></tr>` +
    `<tr><td style="padding:32px 30px"><div style="font-size:12px;font-weight:700;letter-spacing:.8px;color:#3d687d;text-transform:uppercase">NOTIFIKASI SISTEM</div>` +
    `<h1 style="font-size:24px;line-height:1.3;letter-spacing:-.35px;margin:12px 0 18px;color:#17273c">` + htmlEscape(heading) + `</h1>` +
    detail + `</td></tr>` +
    `<tr><td style="padding:22px 30px;background:#f7f9fb;border-top:1px solid #e5eaf0">` +
    `<div style="font-size:12px;line-height:1.7;color:#64748b">Email otomatis dari SIERA DELTA LIMA. Jangan balas email ini.</div>` +
    `<div style="font-size:11px;line-height:1.6;color:#8190a0;margin-top:5px">BagRenmin Densus 88 AT Polri</div></td></tr>` +
    `</table></td></tr></table></body></html>`
  )
}

/** Teks polos disalin persis dari buildOTPEmail (email_templates.go). */
function buildOtpPlainText(code) {
  return (
    'Kode verifikasi SIERA DELTA LIMA\n\nKode OTP Anda: ' +
    code +
    '\nBerlaku 5 menit. Jangan bagikan kode ini kepada siapa pun.\n\n' +
    'Jika Anda tidak meminta kode ini, abaikan email.\n\nBagRenmin Densus 88 AT Polri'
  )
}

/**
 * HTML disusun ulang menyerupai emailShell Go. Byte-nya TIDAK identik —
 * struktur dan gaya setara, tapi penyusun MIME berbeda. Tercatat sebagai
 * deviasi D2 di DEVIATIONS.md; isi email bukan bagian kontrak API.
 */
function buildOtpHtml(code) {
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;background:#ffffff;padding:24px">',
    '<h1 style="font-size:20px;color:#173953;margin:0 0 16px">Kode Verifikasi</h1>',
    '<p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#3c4f5e">',
    'Gunakan kode berikut untuk melanjutkan verifikasi akun Anda.</p>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ',
    'style="background:#f0f5f8;border:1px solid #dbe5ec;border-radius:10px"><tr>',
    '<td align="center" style="padding:20px 12px">',
    '<div style="font-size:34px;letter-spacing:8px;font-weight:700;color:#173953;',
    'font-family:Arial,Helvetica,sans-serif">',
    code,
    '</div><div style="font-size:12px;color:#5b7284;margin-top:10px">Berlaku selama 5 menit</div>',
    '</td></tr></table>',
    '<p style="margin:20px 0 0;font-size:13px;line-height:1.7;color:#607184">',
    'Jangan bagikan kode ini kepada siapa pun. Jika Anda tidak meminta kode, abaikan email ini.</p>',
    '<p style="margin:24px 0 0;font-size:12px;color:#8a9aa7">BagRenmin Densus 88 AT Polri</p>',
    '</div>',
  ].join('')
}
