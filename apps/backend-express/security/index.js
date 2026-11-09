#!/usr/bin/env node
/**
 * Suite integrasi keamanan untuk backend Express — port dari
 * `apps/backend/internal/securitytest` (9 berkas, build tag `r2d5integration`).
 *
 * KENAPA INI ADA. Harness golden-file membuktikan Express dan Go menghasilkan
 * BENTUK respons yang sama. Ia tidak membuktikan siapa yang boleh
 * mendapatkannya, dan ia tidak pernah menjalankan skenario BERURUTAN — OTP
 * dipakai dua kali, CAPTCHA diputar ulang, sesi dicabut saat sedang dipakai.
 * Suite Go menguji semua itu, tetapi menguji BINER GO. Begitu Caddy
 * mengalihkan satu prefix ke Express, suite itu tetap hijau sambil berhenti
 * menjaga backend yang sebenarnya melayani. Berkas inilah penggantinya.
 *
 * Dijalankan lewat `scripts/security-test-express.sh`, yang menyiapkan
 * PostgreSQL ephemeral terisolasi. Jangan dijalankan langsung terhadap
 * database apa pun yang datanya masih dibutuhkan.
 */
import { SecurityAssertionError } from './assert.js'
import { SecurityEnv } from './env.js'
import * as core from './scenarios/core.js'
import { verifyR3BSecureDistribution } from './scenarios/r3b.js'
import { verifyR3CDisposition } from './scenarios/r3c.js'
import { verifyR3D2Hierarchy } from './scenarios/r3d2.js'
import { verifyR3D3Leadership } from './scenarios/r3d3.js'
import { verifyR4A1Usulan } from './scenarios/r4a1.js'
import { verifyR4A2ReviewConsolidation } from './scenarios/r4a2.js'
import { verifyR4A3Budget } from './scenarios/r4a3.js'
import { verifyR4A3BProof } from './scenarios/r4a3b.js'

/**
 * URUTAN INI ADALAH BAGIAN DARI UJINYA, sama seperti di Go.
 *
 * Skenario berbagi state: 05 yang membuat sesi `op`, 07 yang membuat sesi
 * Superadmin, 09 yang membuat dokumen yang dibaca 13. Menjalankannya acak atau
 * paralel bukan "mempercepat" — ia menguji hal yang berbeda.
 *
 * 09b–09i sengaja memakai penomoran bersisipan, bukan 14–21, supaya tetap
 * sejajar satu lawan satu dengan nama subtest di Go dan laporan keduanya bisa
 * ditaruh berdampingan.
 */
const SCENARIOS = [
  ['01_public_status_and_secure_headers', core.publicStatusAndSecureHeaders],
  ['02_anonymous_admin_and_documents_denied', core.anonymousDenied],
  ['03_csrf_origin_and_token_required', core.csrfOriginAndToken],
  ['04_captcha_invalid_replay_and_expiry', core.captchaInvalidReplayExpiry],
  ['05_non_superadmin_otp_off_login', core.passwordOnlyLogin],
  ['06_otp_on_and_superadmin_fail_closed_without_smtp', core.otpFailClosedWithoutSmtp],
  ['07_expired_otp_denied_and_valid_otp_single_use', core.otpExpiryAndSingleUse],
  ['08_superadmin_operational_and_delegation_access_denied', core.superadminOperationalDenied],
  ['09_role_scope_and_cross_unit_document_enforced', core.roleScopeAndCrossUnit],
  ['09b_r3b_secure_distribution', verifyR3BSecureDistribution],
  ['09c_r3c_r3d1_disposition_review', verifyR3CDisposition],
  ['09d_r3d2_parent_child_hierarchy', verifyR3D2Hierarchy],
  ['09e_r3d3_leadership_final_approval', verifyR3D3Leadership],
  ['09f_r4a1_subbagren_usulan_access', verifyR4A1Usulan],
  ['09g_r4a2_internal_review_consolidation', verifyR4A2ReviewConsolidation],
  ['09h_r4a3_verified_budget_realization', verifyR4A3Budget],
  ['09i_r4a3b_private_evidence_reconciliation', verifyR4A3BProof],
  ['10_protected_profile_avatar_and_input_validation', core.profileAvatarAndValidation],
  ['11_otp_toggle_audit_and_live_session_revocation', core.otpToggleAndSessionRevocation],
  ['12_logout_and_disabled_account_rejected', core.logoutAndDisabledAccount],
  ['13_unauthorized_mutation_and_no_secret_leak', core.unauthorizedMutationNoLeak],
]

function line(text = '') {
  process.stdout.write(`${text}\n`)
}

async function main() {
  line('='.repeat(62))
  line(' SIERA DELTA LIMA | UJI INTEGRASI KEAMANAN — BACKEND EXPRESS')
  line('='.repeat(62))

  const env = new SecurityEnv()
  const started = process.hrtime.bigint()
  let passed = 0
  const failures = []

  try {
    await env.setup()
    line(`Skema dibangun, 5 akun fixture dibuat, server di ${env.base}`)
    line('')

    // State bersama antar skenario, padanan variabel `op`, `outsider`, `sa`,
    // dan `docID` di TestR2D5EndToEndSecurity.
    const ctx = { env, op: null, outsider: null, sa: null, docID: '' }

    for (const [name, fn] of SCENARIOS) {
      // Kegagalan satu skenario TIDAK menghentikan sisanya, meniru t.Run():
      // skenario berikutnya kemungkinan ikut merah karena state-nya hilang,
      // dan kegagalan PERTAMA-lah yang harus dibaca lebih dulu.
      try {
        await fn(ctx)
        passed++
        line(`  LULUS  ${name}`)
      } catch (error) {
        failures.push({ name, error })
        const kind = error instanceof SecurityAssertionError ? '' : `[${error.constructor.name}] `
        line(`  GAGAL  ${name}`)
        line(`           ${kind}${error.message}`)
      }
    }
  } catch (error) {
    line('')
    line(`SETUP GAGAL: ${error.message}`)
    line('Tidak ada satu pun skenario yang dijalankan.')
    await env.teardown().catch(() => {})
    process.exit(2)
  }

  await env.teardown()

  const seconds = Number(process.hrtime.bigint() - started) / 1e9
  line('')
  line('='.repeat(62))
  if (failures.length === 0) {
    line(`LULUS — ${passed}/${SCENARIOS.length} skenario keamanan, ${seconds.toFixed(1)} detik.`)
    process.exit(0)
  }
  line(`GAGAL — ${failures.length} dari ${SCENARIOS.length} skenario, ${seconds.toFixed(1)} detik.`)
  line('')
  line('Skenario yang gagal, berurutan — perbaiki yang PERTAMA lebih dulu:')
  for (const f of failures) line(`  ${f.name}`)
  line('')
  line('Kegagalan di sini berarti salah satu dari dua hal, dan keduanya serius:')
  line('  (a) port-nya keliru, atau')
  line('  (b) Express benar-benar berperilaku berbeda dari Go pada jalur otorisasi.')
  line('Jangan melonggarkan pemeriksaan sampai jelas yang mana.')
  process.exit(1)
}

await main()
