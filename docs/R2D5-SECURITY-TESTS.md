# SIERA DELTA LIMA — R2D5 Security Integration Tests

## Dua suite, satu cakupan — jalankan keduanya selama dua backend hidup

| Suite | Menguji | Perintah | Status |
|---|---|---|---|
| Go | `apps/backend` (melayani produksi hari ini) | `bash ./scripts/security-test-r2d5.sh` | 21 subtest |
| Express | `apps/backend-express` (akan menggantikannya) | `bash ./scripts/security-test-express.sh` | **21/21 LULUS, 2026-11-01** |

Suite Express adalah port satu-lawan-satu dari yang Go, dengan nama skenario
yang identik supaya kedua laporan bisa ditaruh berdampingan. Ia ada karena
satu alasan yang mudah terlewat: **begitu Caddy mengalihkan satu prefix ke
Express, suite Go tetap hijau sambil berhenti menjaga backend yang sebenarnya
melayani.** Ia tidak akan merah — ia hanya berhenti relevan.

Harness golden-file tidak menggantikan keduanya. Ia mengukur BENTUK respons,
bukan siapa yang boleh mendapatkannya, dan ia tidak pernah menjalankan
skenario berurutan — OTP dipakai dua kali, CAPTCHA diputar ulang, grant
dicabut saat sesi sedang hidup.

**Suite Express sudah diuji-mutasi**, bukan sekadar dijalankan sampai hijau:

- menghapus pemeriksaan allowlist `Origin` → skenario 03 merah, dan hanya 03;
- menghapus penolakan Superadmin dari endpoint operasional → **7 skenario**
  merah sekaligus (08, 09b, 09c, 09d, 09f, 09g, 09i).

Keduanya dipulihkan sesudahnya. Suite yang lulus pada percobaan pertama tanpa
pernah dibuktikan bisa merah tidak membuktikan apa-apa.

## Isolated execution

Run `bash ./scripts/security-test-r2d5.sh` from SDL project root.

The script uses a **new uniquely named Docker Compose project** for every run, with PostgreSQL 18 stored on **tmpfs**. There are no published ports, no production volume mounts, no real user/email, and no connection to the SDL application stack. It generates isolated database credentials for the test run, uses an internal-only container network at runtime, and removes the isolated containers automatically. **Never supply or reuse the application `.env` / database secrets.**

## Tested using Go HTTP handlers and ephemeral PostgreSQL

- HTTP security headers, no-store status, unauthenticated access denial.
- CSRF cookie and Origin checks.
- CAPTCHA proof-of-work required for login, single-use replay prevention, expiration.
- Password-only login only for a non-Superadmin whose OTP is explicitly OFF.
- OTP ON fails closed if SMTP is unavailable; Superadmin OTP cannot be disabled through login policy.
- OTP verification: expired code denied, valid code accepted exactly once, session created. OTP records are seeded *only in isolated DB* to avoid delivery to real emails.
- Superadmin allowed to read User/Role Management and denied operational and delegation endpoints, even with an accidentally added unit grant.
- Permission and scope checks on live Surat Masuk API, cross-unit and object-level denial.
- Profile endpoint validation, private avatar retrieval, invalid upload rejection and safe JPEG re-encoding.
- OTP policy change audit and live session revocation.
- Logout, disabled user login rejection, anonymous admin write denial and operational audit event.

## Extended Urmin security tests

- R3B specifically addressed distribution and private attachments.
- R3C tasks + R3D1 issuer review.
- R3D2 parent/child forwarding and chain authorization.
- R3D3 final leadership approval: pending approved workflow, Superadmin deny, no grant/no permission, cross-user deny, self approval, CSRF, replay/version, revocation and database-derived 90%/100% progress.
- Target R3D3 suite: **17/17 subtests**; only declare PASS after results verified on Mac.

## Explicitly not covered

- No end-to-end external SMTP delivery/TLS/DNS test (real mail never sent).
- No browser-based E2E layout/accessibility testing.
- No external vulnerability scan or penetration testing; no production evidence.
- No throughput/load, backup restoration, concurrent authorization race/fuzz or destructive data tests.
- No assertion that all 3 Subbag APIs are protected yet: those operational APIs are not implemented.

## Catatan khusus suite Express

Dijalankan **di dalam proses**: backend dihidupkan lewat `createApp()` dan
`http.createServer`, padanan `httptest.NewServer` di Go. Tidak ada service
`api-express` yang terlibat, jadi suite ini menguji kode di working tree —
bukan image yang terakhir di-build.

Empat penjaga sebelum satu baris pun ditulis, sama seperti di Go, dan yang
terakhir paling mudah tergoda untuk dilonggarkan:

1. `SDL_SECURITY_TEST_CONFIRM` harus persis `R2D5_EPHEMERAL_ONLY`;
2. DSN uji wajib ada;
3. `current_database()` harus persis `sdl_security_test`;
4. database harus **benar-benar kosong** — nol tabel berawalan `sdl_`.

Penjaga keempat memastikan skema dibangun dari nol setiap kali, sehingga tidak
ada sisa data yang membuat sebuah pemeriksaan lulus karena alasan yang salah.

Skemanya dibangun runner migrasi Express sendiri (`src/migrations/`), yang
membaca **33 berkas SQL yang sama** dari `apps/backend/internal/migrations/sql/`
lewat bind-mount read-only — tidak disalin (aturan 6 migrasi). Runner itu
sudah diuji silang: database hasilnya diterima `migrations.Run()` milik Go
tanpa menerapkan ulang apa pun, yang berarti nama berkas dan checksum di
ledger identik.

**Release decision**: A PASS is evidence for the listed automated tests only. R2D5 is not complete until test results are reviewed and any failures addressed. Production hardening remains R6.

R4A1 Mac 18/18 PASS pada 2026-10-20. R4A2 menambah kasus `09g_r4a2_internal_review_consolidation` (target 19/19, belum diverifikasi di Mac): return, review terpisah, revision, resubmit, history, grant revocation, read+consolidate, CSRF, class constraints.

## R4A3A security extension (pending Mac)
The R2D5 isolated suite now includes 09h_r4a3_verified_budget_realization: proposal internal approval prerequisite, permission-off deny, CSRF, outsider, Superadmin deny, dual control, stale version, verified-only totals, overspending rejection, and grant revocation. Target 20/20; not yet verified on user's Mac.


## R4A3B (target 21/21; Mac verification pending)

Additional integration scenario `09i_r4a3b_private_evidence_reconciliation` on isolated ephemeral PostgreSQL: media sniffing, CSRF, cross-unit denial, Superadmin denial, duplicate active proof denial, encrypted readback with forced download, tamper detection (AES-GCM + hash), replay rejection, revocation of role grant, scoped financial reconciliation. Existing 09h scenario now requires independent uploaded proof approval before verification; financial overspend checks remain.

Dedicated encryption key is generated by the installer and passed into the local API only; key is not printed to logs. Source checks are not full penetration tests or document authenticity validation.
