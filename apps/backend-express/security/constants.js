/**
 * Nilai tetap yang ditiru persis dari suite Go
 * (`internal/securitytest/security_integration_test.go:32`).
 *
 * Secret dan kunci bukti sengaja berupa byte berulang, bukan acak: suite ini
 * MENYUNTIK baris `sdl_login_challenges` langsung ke database dengan HMAC yang
 * dihitung sendiri, jadi nilainya harus diketahui alat uji. Keduanya hanya
 * pernah ada di database ephemeral yang dibuang setiap kali.
 */

export const ORIGIN = 'http://127.0.0.1:5174'
export const FIXTURE_PASSWORD = 'SDL-R2D5-Temporary-Test-Only-Password!'

/** bytes.Repeat([]byte{0x5d}, 32) di Go. */
export const AUTH_SECRET_HEX = '5d'.repeat(32)
/** bytes.Repeat([]byte{0x4a}, 32) di Go. */
export const EVIDENCE_KEY_HEX = '4a'.repeat(32)

/** Nama database yang satu-satunya boleh disentuh. */
export const TEST_DATABASE = 'sdl_security_test'
export const CONFIRM_TOKEN = 'R2D5_EPHEMERAL_ONLY'
