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

  /** Padanan Mailer.SendOTP. Melempar kalau gagal; pemanggil yang memetakan ke 503. */
  async sendOtp(destination, code) {
    if (!this.ready()) throw new Error('smtp not configured')
    if (!validAddress(destination)) throw new Error('invalid email')
    if (!/^[0-9]{6}$/.test(code)) throw new Error('otp_format_invalid')

    const transport = nodemailer.createTransport({
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
