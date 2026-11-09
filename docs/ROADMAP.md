# SIERA DELTA LIMA — Master Development Checklist

**One Workspace. Full Visibility.**  
Integrated Digital Workspace for BagRenmin

Last reviewed: 2026-10-17. Status is based on actual Mac logs. A frontend preview does NOT mean the corresponding operational API, identity enforcement, or database CRUD exists. This file and `apps/frontend/src/DevelopmentChecklist.tsx` must be updated together after each verification gate.

## R1 — Foundation: VERIFIED (Mac)
- [x] Project root `1.siera-delta-lima`, Go API and React/TypeScript/Tailwind/Vite.
- [x] PostgreSQL 18 in isolated Docker volume; three containers healthy.
- [x] Go tests, Go build and React TypeScript/Vite build pass.
- [x] User confirmed dashboard opens at `http://127.0.0.1:5174`.

## R2A — Database security foundation: VERIFIED BY STARTUP LOG (2026-10-17 local)
- [x] R2A patch installed; old Docker database volume preserved.
- [x] Migration runner reported `schema migrations applied` (phase r2a).
- [x] API responded ready with phase `foundation-r2a`; database, API, frontend healthy.
- [x] Go tests and React build passed during R2A rebuild.
- [ ] Optional deeper audit: query migration ledger/checksums and table constraints directly in PostgreSQL. Not required before applying UI-only R2B-UI patch.

## R2B-UI — Shared UI/UX design system: VERIFIED BY USER IN BROWSER
- [x] UI patch installed and user confirmed the design in browser.
- [x] UI visually accepted as shared renmin.html-derived system.
- [ ] Verify responsive desktop/mobile layouts, navigation and light/dark modes.
- [ ] Verify login design is preview-only and data actions are disabled.
- [ ] Verify logo `apps/frontend/public/ds.png` if present; otherwise official asset must be supplied.

## R2B — Secure Authentication: PATCH READY, MAC E2E VERIFICATION PENDING
- [x] Bootstrap Superadmin via interactive protected setup; user confirmed creation on Mac.
- [x] Argon2id password hashing in backend source; bootstrap complete.
- [x] OTP email login completed end-to-end as confirmed by user; expiry/attempt-limit negative testing pending.
- [x] PostgreSQL session active for successful login; HttpOnly/CSRF/throttle implemented in source, adversarial tests pending.
- [x] User confirmed browser login with OTP successfully.
- [ ] Negative tests: logout revocation, CSRF reject, throttling, OTP replay/expiration, disabled user.

## R2C1 — Role & Permission Editor: PATCH READY, MAC BUILD/E2E VERIFICATION PENDING
- [ ] Role catalog and permission matrix (React + backend Go CRUD) verified on Mac.
- [ ] Superadmin-only guard, protected role, reserved permission, CSRF, reasons and version conflicts tested.
- [ ] Role change audit and affected-session revocation tested.

## R2C2 — Users, role assignment & ABAC: NOT STARTED
- [ ] Users and unit-scoped role assignment (own, assigned, unit, delegated, expiry).
- [ ] Resource-level deny-by-default + ABAC policy enforcement in backend.
- [ ] Superadmin not automatically authorized to read documents.
- [ ] Audit viewer, permission effective preview and negative security test suite.

## R3 — Urmin
- [ ] Surat masuk/keluar, attachments, disposition and approval.
- [ ] Search, status tracking, document history and auditability.

## R4 — BagRenmin Subbag
- [ ] Subbagren, Subbagsumda, Subbagbinfung according to approved processes.

## R5 — Leadership visibility
- [ ] Permission-scoped dashboards, KPIs and aggregate views.

## R6 — Production readiness
- [ ] Integration and security tests, restore-tested backups, HTTPS and rollout.

### Release rule
- R2B-UI patch already accepted by user; R2B auth explicitly updates Go backend and Compose config while preserving all SQL and the volume.
- No `down -v`, no destructive migrations, no sending secrets to the frontend.
- Data and status indicators must come from API; never invent KPIs or permissions.
- UI-only routing and identity preview must not be mistaken for security controls.

## R2B verification gates (pending Mac)
- [ ] Apply R2B Go/Auth patch and run `./sdl-run.sh` (no new database migration).
- [ ] Verify Go unit tests and React build in Docker, all service healthy.
- [ ] One-time Superadmin bootstrap from secure stdin with no default credentials.
- [ ] Configure TLS SMTP in root `.env` locally (never send credentials to chat).
- [ ] Browser login → OTP email → authenticated portal → logout.
- [ ] Verify unknown password, wrong/replayed/expired OTP, CSRF rejection and missing session return denied.
- [ ] R2C will enforce all unit/role/document scopes on actual business endpoints.

## R2C2A (2026-10-17) — Menunggu verifikasi Mac

- [x] Rancangan UI dan source User Management + scoped grant siap
- [x] Migration 004 add-only dirancang untuk database yang sudah berjalan
- [x] Rule evaluator deny-by-default untuk scope/klasifikasi/status disiapkan beserta unit test
- [ ] Build/Go tests di Docker Mac lulus
- [ ] Migration 004 diterapkan dan checksum diverifikasi
- [ ] UI add/edit user dan assignment role per unit benar-benar tersimpan
- [ ] Login OTP user baru + mandatory password rotation teruji
- [ ] Authorization negative tests, audit dan session revocation diverifikasi
- [ ] Implementasi ABAC di setiap endpoint data/dokumen (gate R3, belum aktif)

## R2C2B — Delegasi terbatas (2026-10-17) — PATCH READY, MAC VERIFY PENDING
- [x] Source patch: migration 005 additive, Go API administrative, scoped delegated grant evaluator, React management page.
- [x] Control design: unit-only source grant, same-unit recipient, source role permission subset, max 14 days, no admin/audit/approval/export, expiry, revoke reason, audit, session revoke.
- [ ] Mac: Docker Go tests/build + React TypeScript/Vite build lulus.
- [ ] Mac: migration 005 applied, existing Superadmin/login/OTP and migration ledger intact.
- [ ] Mac UI: create from active source grant, refresh, revoke, expired/changed-source deny.
- [ ] Negative API integration: CSRF, non-Superadmin, cross-unit, inactive users, source grant revoke, classification, permission removal, expiry.
- [ ] R3: enforce `access.EvaluateForUser` against DB-loaded document metadata on EVERY data, download, approval and list endpoint. Not a live document permission until R3.
- [ ] R3: approval delegation workflow and policy editing require additional design and negative tests.

## SA01 — Pembatasan Superadmin (R2C2B)
- [ ] Backend Go menolak akses operasional Superadmin walaupun memiliki scoped grant (uji DB/integration).
- [ ] Menu seluruh unit tetap tampil tetapi disabled untuk Superadmin.
- [ ] Hanya User & Role Management aktif; delegasi diblokir (403).
- [ ] Migration 006 merekonsiliasi role permissions Superadmin menjadi dua izin identitas.
- [ ] Build Docker, migration, login OTP, pengujian positif/negatif, dan audit lulus di Mac.

## R3A — Surat Masuk Urmin (PATCH READY; MAC VERIFICATION REQUIRED)
- [x] Source Go API, transaksi register draft, history perubahan dan UI React disiapkan.
- [x] Migration 007 hanya CREATE TABLE/INDEX dan menyimpan nomor agenda database.
- [ ] Go tests & frontend build lulus melalui Docker Mac.
- [ ] Migration 007 berhasil, checksum ledger cocok, service healthy.
- [ ] Akun bukan Superadmin dengan role/grant Urmin create/read/update bisa membuat, membaca, mengedit draft dan meregister.
- [ ] Superadmin 403; akun lintas unit dan tanpa grant ditolak; klasifikasi penting dibatasi.
- [ ] Histori tercatat atomik; dokumen terdaftar tak bisa diedit; version conflict menghasilkan 409.
- [ ] Pagination terfilter di SQL (R3B); R3A list bounded 200 kandidat dan filter per objek.
- [ ] Lampiran, disposisi, distribusi/approval baru pada R3B+.

## R2D — Identity, Access & UX Refinement (2026-10-18)
- [x] **R2D1 Local CAPTCHA & OTP (happy path):** Docker build/migration 008 healthy, CAPTCHA hotfix berhasil dan pengguna mengonfirmasi CAPTCHA bekerja di browser.
- [ ] **R2D1 Negative security tests:** CAPTCHA replay/expiry, OTP ON/OFF user biasa, session revocation, Superadmin tidak bisa OFF.
- [ ] **R2D2 Roles & ABAC UX:** toggle ON/OFF, mode sederhana/lanjutan, scope & classification buttons, ringkasan grant aktif read-only dari Go API. Patch disiapkan; belum diuji di Mac. Ringkasan bukan izin dokumen final; Go enforcement unchanged.
- [ ] **R2D3 User Management UX:** user table, search/filter, add/edit modal, responsive.
- [ ] **R2D4 Profiles:** self-edit profile, safe local avatar upload, password/email-verification workflows including Superadmin.
- [ ] **R2D5 Security gate:** CAPTCHA replay/expiry/rate limits, OTP ON/OFF, session revocation, CSRF, regression and access denial tests.

## R2D3 — User Management Table & Modal (2026-10-18)
- [x] UI source prepared: server-backed user list, search, unit/status/OTP filters, client-side pagination of up to 500 newest accounts returned by current Go API.
- [x] Add User modal retains secure one-time temporary password display; Edit User modal has Profile, Role & Unit, and Security & OTP tabs.
- [x] Profile/access updates and OTP changes continue using existing authenticated Go endpoints, CSRF, reason, session revocation and optimistic version checks.
- [x] Superadmin protected; no operational access granted; UI and API security remain unchanged.
- [ ] Mac: R2D2 installed/verified, R2D3 TypeScript/Vite build and frontend healthy.
- [ ] Mac E2E: search/filter/pagination; create user and one-time password; edit profile; assign/revoke role+unit; OTP ON/OFF; audit and refresh persistence.
- [ ] Future: server-side paginated/search user API for accounts beyond the current bounded 500-result listing; My Profile/avatar (R2D4).

## R2D4 — My Profile + Avatar (PATCH READY, MAC VERIFICATION PENDING)
- [x] Source prepared: session-bound self-profile endpoint, name/phone edit, validated private avatar, password rotation UI, verified email-change OTP, audit.
- [x] Additive migration `009_self_profile.sql` adds profile phone, private `BYTEA` avatar, and email challenge table; existing user records retained.
- [x] React My Profile for all users including Superadmin, following `renmin.html` navy/gold UI.
- [ ] Mac: Go unit tests & React Vite/TypeScript build succeed; migration 009 applied; all containers healthy.
- [ ] Browser: each role can edit its own name/phone, upload JPG/PNG/WebP image, remove avatar, refresh with persistence.
- [ ] Security: password rotation, email OTP to new address and 5-minute expiry, invalid/reused code, CSRF, other sessions revoke, no cross-user avatar reads, no Superadmin operational access.
- [ ] R2D5: complete negative integration/security test matrix and recovery/backup test.


## R2D5 — Automated Security Integration Gate (2026-10-18)
- [x] Package prepared: isolated PostgreSQL 18 on tmpfs, private Docker network, test-only Go HTTP integration runner; no application DB/volume or SMTP credentials used.
- [x] Test suite authored for CAPTCHA single-use/expiry, CSRF/origin, OTP policies, protected Superadmin, cross-unit Urmin, audit, session revocation and private avatar.
- [ ] Go security integration suite successfully run in Mac Docker and log reviewed (NOT YET VERIFIED).
- [ ] Any failing tests fixed in source and re-run from a clean isolated database.
- [ ] Remaining coverage: SMTP TLS/delivery in a controlled environment, browser E2E, advanced delegation, rate limits, concurrency, recovery/backup, vulnerability scans and production security hardening.
- [ ] R2D5 sign-off only after reviewed evidence; R6 production readiness is a separate gate.

Run: `bash ./scripts/security-test-r2d5.sh`. Reports: `0.sekerips/reports/sdl-r2d5-*.log`.

## R3B — Lampiran Privat & Distribusi Terarah (PATCH READY, MAC VERIFY PENDING)
- [x] Source: migration 010 append-only attachment, delivery and event tables; Go endpoints with session+CSRF and resource authorization.
- [x] Source: per-file 5 MiB cap, at most 10 attachments/letter, JPG/PNG/PDF validation, SHA-256 integrity, download only via authenticated endpoint, forced attachment.
- [x] Source: unit + explicitly addressed user; receiver must hold active grant + `urmin.distribusi.receive` permission and adequate classification limit.
- [x] Source: inbox for Urmin and other BagRenmin units; immutable sent/received events and audit records.
- [x] R2D5 isolated test extended with `TestR3BSecureDistribution` and R3B file-validation tests.
- [ ] Mac `./sdl-run.sh`: Go tests, React build, migration 010 and health-check green.
- [ ] Mac isolated test: `bash ./scripts/security-test-r2d5.sh` PASS including `TestR3BSecureDistribution`.
- [ ] Browser: Urmin registers letter, upload, distribute, recipient inbox & acknowledgement, histori persisted after refresh.
- [ ] Negative: Superadmin 403, unauthorized receiver 404/403, revoked grants deny, repeat receive 409, unsupported file rejected.
- [ ] Pending production gate: malware scanning before file is trusted, concurrency review, performance and backup/restore, HTTPS external deployment.
- [ ] R3C: layered leader disposition and follow-up workflow (NOT included in R3B).

**Permission setup:** Sender needs `urmin.surat_masuk.read`, `.attach`, `.download`, `.distribute` in the SAME active Urmin grant with adequate classification and resource scope. Recipient needs `urmin.distribusi.receive` in an active grant for its OWN target unit, scope `assigned` or `unit`, matching classification. Role changes via Superadmin FE. No permission seeded to roles by this patch.

Verified evidence on 2026-10-18: R2D5 baseline integration suite **13/13 PASS** in isolated PostgreSQL per user-provided Mac terminal log; production penetration testing, SMTP TLS, and restore-test remain pending.


## R3C — Disposisi Terarah & Tracking Tindak Lanjut (PATCH, BUILD MAC PENDING)

- [x] Source: additive migration 011 untuk task disposisi serta event append-only.
- [x] Source: penerima distribusi yang telah mengonfirmasi penerimaan + permission `urmin.disposisi.issue` dapat menugaskan petugas yang dipilih secara eksplisit di **unit yang sama**.
- [x] Source: penerima harus memiliki `urmin.disposisi.execute` dalam grant aktif unitnya; Superadmin tidak boleh mendapat izin operasional.
- [x] Source: Pending → In Progress → Completed; tenggat, catatan, version-based optimistic concurrency, audit.
- [x] Source: Inbox Tugas, form disposisi dari Inbox Distribusi, tracking bagi pemegang permission `urmin.disposisi.read` dan `urmin.surat_masuk.read`.
- [x] Source: R2D5 suite diperluas dengan skenario negatif R3C (grant, CSRF, replay, status, Superadmin, akses lintas user).
- [ ] Verifikasi Mac: Go unit, frontend build, migration 011, containers healthy.
- [ ] Verifikasi Mac: isolated security suite 09c R3C PASS, tanpa regresi 01–13/R3B.
- [ ] Browser E2E: kepala unit menerima distribusi, membuat disposisi, petugas menerima dan menyelesaikan, histori persisten.
- [ ] Production gate: malware scanning lampiran, otorisasi concurrency multi-sesi, backup restore, SMTP TLS, performance, peninjauan tahapan persetujuan berjenjang lebih lanjut.

**Batas R3C:** Disposisi tahap ini *hanya satu level dari penerima distribusi ke petugas satu unit*. Disposisi lintas unit, multi-hop, approval, revisi hasil, dan SLA eskalasi **belum** diimplementasikan; perlu persetujuan workflow spesifik. Tidak ada grant permission otomatis ke user/role lama. Superadmin harus mengaktifkan permission issue dan execute pada role operasional yang sesuai.

Bukti pengguna: R3B Go/React/DB healthy; R2D5+R3B security suite **14/14 PASS** (2026-10-18).

## R3D1 — Review Hasil & SLA (Mac build/security PASS; browser E2E pending)

- Review hasil tugas completed dengan permission khusus untuk issuer.
- Indikator SLA dihitung on-demand; event review dan audit append-only.
- Tidak membuat hierarki atau approval Kabagrenmin otomatis; R3D2 pending.
- Migration 012 additive; isolated regression suite harus PASS.

## R3D2 — Parent/Child Disposisi (2026-10-20) — MAC BUILD + SECURITY PASS
- [x] Model hierarchy root + two forwarded levels, self/ancestor loop prevention and strict recipient grants; source code prepared.
- [x] Additive migration 013 adds `parent_task_id`, `depth` and `urmin.disposisi.forward`; prior task rows remain roots.
- [x] Parent cannot complete until all immediate children finish AND receive a review decision; each issuer reviews own child's result.
- [x] Forwarding requires live `execute` + `forward` grants; no automatic role grant. Same unit/classification; child due date <= parent due date.
- [x] Chain is invalid if original distribution revoked or any issuer's grant along chain is revoked.
- [x] Mac Docker `./sdl-run.sh` Go tests, React build and migration runner 013 succeeded (log 2026-10-20).
- [x] Mac isolated R2D5 security suite **16/16 PASS** including 09d hierarchy (log 2026-10-20).
- [ ] Browser: distribute dummy letter -> issue root -> accept -> forward to child/grandchild -> review leaf -> close parent -> approve root.
- [ ] Browser: test permissions, 403 and no access to unaddressed users; no production approval until E2E, pen test and malicious-file scanning complete.


## R3D3 — Kabagrenmin Final Approval & Live Progress (Mac build + security PASS; browser E2E pending)

- R3D2 Go/React build, migration runner 013 dan PostgreSQL-isolated security 16/16 telah **PASS menurut log Mac**. Browser Functional E2E R3C–R3D2 tetap pending.
- Permission baru **tidak otomatis diberikan**: `urmin.disposisi.final.submit` untuk pemberi tugas root dan `urmin.disposisi.final.monitor` + `urmin.disposisi.final.approve` untuk role `br_kabagrenmin` dengan grant unit aktif. Superadmin tetap tidak memiliki akses operasional.
- Kepala Unit hanya bisa mengajukan root jika seluruh tugas pada pohon disposisi telah **completed + reviewed approved**. Pengajuan sekali per root, reviewer pimpinan tidak boleh menjadi peserta di rantai itu; keputusan final `approved` / `revision_requested` tidak dapat ditimpa.
- API `GET /api/v1/urmin/dispositions/leadership` menyajikan ringkasan terbatas menurut **role Kabagrenmin, permission, grant unit dan klasifikasi**. Progres dinamis = `(tugas completed + reviewed approved / jumlah tugas) × 90%`, **100% hanya jika final approved**. Daftar dibatasi 151 root terbaru dan menandai keterbatasan statistik; angka bukan agregasi semua data jika truncated. Auto-refresh frontend 60 detik + manual refresh. Tidak ada update progres dummy.
- Monitoring ini hanya konteks root surat yang memiliki disposisi, bukan seluruh surat masuk tanpa tugas atau dashboard institusional penuh.
- Migration `014_leadership_approval.sql` additive; Mac Docker Go/React build, health, migration runner dan security subtest 09e telah lulus pada 2026-10-20. Total 17/17 skenario security PASS; browser E2E tetap pending.
- Jika keputusan `revision_requested`, tugas yang telah selesai **tidak dibuka ulang otomatis**; tindak lanjut memerlukan penugasan terpisah dan proses tata naskah lanjutan.
- Belum termasuk browser E2E, load/concurrency test, mail notifications, anti-malware attachment scanning, atau production readiness.


## R3E — Functional E2E Persuratan Lima Level (2026-10-20; PRE-FLIGHT PENDING)

- [x] R3D3 Mac Docker Go/React build, API readiness 3/3 healthy dan isolated security suite **17/17 PASS** berdasarkan output terminal pengguna.
- [x] Siapkan preflight *read-only* agar konfigurasi grant/permission akun yang sudah dibuat diverifikasi sebelum browser E2E. Tanpa seed akun, reset DB, atau auto-grant.
- [ ] Jalankan `bash ./scripts/r3e-readiness.sh` di Mac dan perbaiki role permission/grant hanya lewat Superadmin Role & User Management sesuai kebutuhan.
- [ ] Browser: Operator Urmin membuat surat dummy **Biasa**, register, upload lampiran uji aman, distribusi ke Kasubbagren, penerimaan.
- [ ] Browser: Kasubbagren mengeluarkan disposisi root -> Staf mengerjakan/meneruskan -> Operator menjalankan child -> review child -> root selesai dan direview.
- [ ] Browser: Kasubbagren mengajukan approval final -> Kabagrenmin memutuskan -> indikator progres 100% hanya setelah Approved -> histori konsisten setelah refresh.
- [ ] Negatif: pihak tanpa penunjukan tidak bisa membaca, self-approval ditolak, Superadmin tetap tidak bisa akses operasi, perubahan permission/revoke berpengaruh.
- [ ] Uji browser sungguhan tetap diperlukan. Readiness = pemeriksaan konfigurasi saja, bukan lulus E2E; dokumentasikan bukti screenshot/log tanpa rahasia.

Instruksi `docs/R3E-FUNCTIONAL-E2E.md`. `R2D5` security suite menyimulasikan transaksi Go di PostgreSQL terisolasi; bukan pengganti pengujian browser terhadap aplikasi di Mac.


## R4A1 — Subbagren: Register Usulan Perencanaan & Anggaran (2026-10-20, **MAC BUILD + SECURITY 18/18 PASS; BROWSER E2E PENDING**)

**Konteks pekerjaan nyata:** mengkompilasi usulan subsatker, menyiapkan Renstra/Renja/RKKS/DIPA/Renaksi/Rengiat/Rendisgar/KAK/TOR/RAB, lalu memantau realisasi anggaran, deviasi, capaian kinerja, LKIP/LAKIP, hibah. R4A1 **hanya membangun fondasi register usulan internal**, bukan menggantikan e-Sirena/e-Monev, melakukan approval pagu/DIPA, atau mengotomatisasi tugas lain tanpa workflow yang disetujui.

- [ ] Migration `015_subbagren_usulan.sql` diterapkan di Mac. Membuat tabel usulan dan histori, permission `subbagren.usulan.{read,create,update,submit}`. **Tidak auto-grant** role/akun, tidak reset data.
- [ ] Go API `GET /api/v1/subbagren/usulan/`, `GET /capabilities`, `POST /`, `GET /{id}`, `PATCH /{id}`, `POST /{id}/submit` diuji pada Mac.
- [ ] Browser: Subbagren membuat draft (tahun, asal pengusul, kegiatan, output target, estimasi rupiah, klasifikasi), mengubah draft, submit, memeriksa histori; submit mengunci draft sampai workflow review R4A2 tersedia.
- [ ] Pemeriksaan negatif: Superadmin 403, user tanpa grant/permission tidak melihat data; scope own/assigned/unit dan klasifikasi pada tiap record; CSRF/Origin, validasi input, version race ditolak.
- [ ] Regression suite R2D5 **18/18 PASS di Mac 2026-10-20**, termasuk subtest 09f usulan dan 17 kasus lama; browser E2E masih wajib.
- [ ] Browser E2E R3E dan 5 akun `CHANGE_PASSWORD_FIRST` tetap pending, tidak dianggap PASS meski R4A1 dilanjutkan.

**R4A2 selanjutnya:** review/return usulan, versioned pagu/revisi, konsolidasi per program dan indikator. **R4A3:** realisasi dan deviasi, rencana tindak lanjut dan pelaporan. Semua status/progress berbasis catatan transaksi, tidak dummy. Detail scope `docs/R4A1-SUBBAGREN-USULAN.md`.


## R4A2 — Review Internal, Revisi dan Konsolidasi (2026-10-20; **MENUNGGU VERIFIKASI MAC**)

- [x] R4A1 telah lulus Mac Docker build dan isolated security suite 18/18 (dilaporkan pengguna 2026-10-20). Browser E2E masih **pending**.
- [ ] Build Go/React, migration 016, dan integration suite 19/19 R4A2 menunggu log Mac.
- [ ] Reviewer yang **berbeda dari pembuat usulan**, memiliki `read` dan `review`, dapat memberi keputusan internal approved / revision_requested. Reviewer tidak bisa mengubah/menyetujui usulannya sendiri.
- [ ] Pembuat yang mendapat pengembalian dapat merevisi melalui endpoint khusus; perubahan klasifikasi memerlukan grant sesuai klasifikasi yang baru, lalu ajukan ulang. Riwayat review immutable dan versi atomik.
- [ ] Konsolidasi dikelompokkan berdasarkan tahun/unit asal, hanya usulan `approved` dengan `read` + `consolidate` per record. Nilai anggaran agregat dikirim sebagai string integer rupiah untuk menghindari presisi JS. Rekap dibatasi 2000 kandidat; bila melampaui batas **tidak menghasilkan total parsial**.
- [ ] Tidak ada tindakan yang menandakan pengesahan DIPA/pagu; tidak ada auto-grants; Superadmin tetap ditolak oleh AuthorizeOperational.
- [ ] R3E lima akun CHANGE_PASSWORD_FIRST dan browser E2E masih pending, tidak dibypass.

R4A3 selanjutnya: perencanaan pagu/revisi terpisah dari review internal, realisasi anggaran, target & deviasi, dan monitoring berbasis bukti transaksi.


## R4A3A — Pagu & Realisasi (Mac build + 20/20 Security PASS 2026-10-21; Browser E2E pending)

- [x] R4A2 build and security integration verified by Mac log: 19/19 PASS, 3/3 healthy. Browser E2E still pending.
- [x] Developed migration 017, independent pagu and realization ledger, actor-separated verification, server-side transaction lock/remaining-pagu checks, and access-scoped overview.
- [x] Developed frontend financial screen, unit tests, and negative security integration test 09h for R4A3A.
- [x] R4A3A patch installed; Go and React builds PASS, migration runner success, 3/3 containers healthy (Mac log 2026-10-21). Migration 017 individual row still to be independently checked.
- [x] Isolated security suite 20/20 PASS on Mac, including 09h. Browser E2E not yet tested.
- [ ] Browser E2E with two real authorized personnel and genuine budget authorization document.
- [ ] R4A3B: encrypted/private actual file evidence, metadata/files retention, and deeper period-based reporting.

Financial integrity rules: estimated proposal is NOT actual pagu; internal proposal approval is NOT DIPA approval; pagu requires an independent human verifier, realization counts ONLY when independently verified, verified totals may not exceed verified pagu, and change history is append-only. Reference-only proof metadata is not proof-file authentication. No role permissions auto-granted.


## R4A3B — Bukti Realisasi & Rekonsiliasi (2026-10-21; SOURCE READY; MAC GATE PENDING)

- [x] Created additive migration 018 for private encrypted evidence (AES-256-GCM envelope stored as ciphertext inside existing PostgreSQL private DB). No modification to earlier verified financial figures.
- [x] Dedicated 32-byte `SDL_EVIDENCE_KEY` is required for upload/download/financial verification and is created locally by installer if absent. Never reused from login/session secret. Key loss makes historic proof ciphertext unrecoverable.
- [x] Uploaded PDF/JPEG/PNG <= 5 MiB, authenticated download with forced attachment, SHA-256 and AES-GCM integrity verification, one active evidence file per pending realization, immutable older rejected files, append-only audit history.
- [x] New realization verification **cannot transition to verified** unless distinct checker approved the evidence and integrity checks PASS. Pending/rejected transactions excluded from used amount.
- [x] Reconciliation per source-unit and fiscal year includes verified pagu/realisasi, pending/rejected transactions and missing/pending/rejected evidence; scoped RBAC and classification; bounded views flagged incomplete.
- [x] Source status & health phase corrected from `subbagren-r4a2` to `subbagren-r4a3b`. Added file security tests and no auto-grants.
- [ ] Mac: installer exact baseline, Docker build Go/React, migration 018, security integration target **21/21 PASS** (new 09i).
- [ ] Browser E2E: distinct data maker and checker; file upload/download/review, year-based reconciliation, negative grants, cap checks.
- [ ] Production gate still pending: malware scanner, external authenticity/legality of documents, formal archival and retention, key rotation and disaster-recovery restore test, HTTPS/TLS production, pagu document file proof, financial reconciliation against treasury source.

R3E five accounts requiring first password changes and browser E2E remain pending. No bypass or automatic activation. R4A3B reconciliation is **NOT official LRA**; unit labels reflect user-entered source unit in the proposal.


## R5A — Functional First: Berkas, Foto & Disposisi untuk 4 Unit (2026-10-21; BUILD MAC & BROWSER TEST PENDING)

- [x] R4A3B Go+React Docker build, 3/3 healthy and 21/21 isolated security integration suite PASS from user-provided Mac output; Browser E2E remains pending.
- [x] Additive migration 019 creates live PostgreSQL tables for unit records, binary PDF/JPG/PNG files, internal assignments and event history for Urmin, Subbagren, Subbagsumda and Subbagbinfung.
- [x] Shared React **Berkas, Foto & Disposisi** in each unit's sidebar and unit dashboard. Backend support for Create, List/Search, Read/Detail, Update, Soft Delete, Upload/Preview/Download/Delete files, Assign/Receive/Complete/Cancel internal tasks, and history.
- [x] Existing session, first-login password rotation and active scoped unit access grants remain enforced; Superadmin never operates unit data; no new role grants. Unit assignment is limited to active member of same unit and classification.
- [ ] Mac: install exact SHA verified patch, Go unit tests, frontend build, additive migration 019 and three healthy services.
- [ ] Real user browser CRUD E2E: create/edit/delete a record, image preview, PDF download, send assignment to a second operational user, receive, complete and refresh to validate persisted history.
- [ ] Detailed HR/asset fields for Sumda, policy/SOP/evaluation fields for Binfung, other specialized form modules, cross-unit formal letter routing beyond existing Urmin disposition, document encryption at rest, malware scanning, quota and full backup restore rehearsal remain pending.

**Fast functionality scope:** This is a common per-unit administrative document/assignment register, not replacement for specialized personnel/BMN/SOP records. Deleted items are soft-archived to retain history. All uploaded files are private DB BYTEA and MUST NOT contain sensitive operational data before production hardening and retention validation. R3E five first-login passwords must still be changed.


## R5B — Subbagsumda: Master Data CRUD (2026-10-21; menunggu pengujian Mac)

- [x] R5A verified from Mac log: installer checksum PASS, Go unit tests + React build PASS, three containers healthy; real browser CRUD and disposition still pending.
- [x] Built additive migration 020: dedicated personel, pendidikan/pelatihan and inventaris/BMN structured register tied to R5A work record; unique active code per category, soft-delete, versioned edit and history.
- [x] New operational UI for Personel, Pendidikan and Inventaris; create/list/search/read/edit/archive, plus direct open to R5A photo/PDF/disposition. No duplicate file store.
- [ ] Mac build and migration 020 verified; all three menus display active API and CRUD persist after refresh.
- [ ] Browser: create/change/soft-delete each kind; attach and preview JPG/PDF; assign to another active person in Subbagsumda; receive/complete; history persists across reload.
- [ ] Follow-up: layanan kepegawaian, pemeliharaan logistics, detailed HR relationship and operational data constraints.

Development follows CRUD-first. Existing session, active unit grants, first-login password rotation and Superadmin operational denial remain in force. These fields are for development/dummy data, not highly sensitive personnel records before production review.


## R5C — Subbagbinfung Functional CRUD (2026-10-22; build/browser Mac pending)

- [x] Additive migration 022 and structured master registers for SOP/Regulasi, PID, RB/SPIP, ABK, Pembinaan, and Evaluasi; each tied to existing R5A work records for JPG/PNG/PDF and internal dispositions.
- [x] Dedicated Go REST endpoints for create, read/list/search, edit with versioning, and soft-archive; role/unit/classification enforced by existing active grants and limited DEV-only Superadmin workspace mode.
- [x] Polished modal-based React UI consistent with R5B UX01; six real sidebar menus, reloadable persisted data and direct File & Disposisi shortcuts.
- [ ] Mac: verified Go and React build, migration 022 applied, all three containers healthy.
- [ ] Browser: CRUD+refresh for all six menus; photo/PDF upload/read, assignment to second same-unit user and persistent status history.
- [ ] Follow-up: field enrichment from official unit-specific form templates, real workflow validations, pagination and export.

R5B DEMO01 remains DEV-only on sdl_root_dev and must never be enabled in production. R3E browser E2E and earlier specialized module browser tests remain pending.


## R5D — Urmin: Surat Keluar, Agenda & Rapat, Arsip (2026-10-22; Mac build/browser pending)

- [x] R5C source installed on Mac, Go unit tests/React build and Docker 30/30 PASS, 3/3 containers healthy; health phase `binfung-r5c`, Superadmin DEV workspace enabled. Browser CRUD and upload/disposition remain pending.
- [x] Migration 023 adds Urmin structured registers for outgoing-letter drafts/metadata, agenda/meeting information, and archive metadata, linked to R5A record for photo/PDF and internal dispositions.
- [x] CRUD with search/list, optimistic versioned edit, soft archive, independent record history and pre-existing Urmin scoped access; R5B DEMO01 dev-only Superadmin permitted under original local gate.
- [x] React responsive forms/modal and table for three Urmin menus; reused consistent design; no credentials or role changes.
- [ ] Mac Docker build, verified migration 023, three healthy services, Urmin browser create/edit/archive/refresh, PDF/photo upload, internal assignment receive/complete.
- [ ] Full formal letter issuance workflow, legally assigned letter numbering, digital signature, actual delivery integrations, canonical records retention and calendar invites remain pending. **A register status does not certify a sent/signed official letter**.

Environment for patch: local development only (`sdl_root_dev`); do not use real confidential documents before production hardening.


## R5E UX01 — Branding & Portal Ringkas (2026-10-22; Mac verification pending)

- [x] R5D UX03 installer and React/Go build reported PASS on Mac; all three services healthy. Browser verification not fully completed.
- [x] Local asset `apps/frontend/public/logo.png` selected as the shared brand logo for header/login/portal/favicon; installer will require it already exists and will not overwrite it.
- [x] Frontend portal simplified: concise heading, four unit choices, roadmap shortcut, admin shortcuts; removed filler metrics, stale technical panels, and temporary access-mode banner.
- [x] Simplified user-facing descriptions across active administration screens; backend authorization remains unchanged.
- [ ] R5E Mac build and browser check: header, login logo, favicon, unit cards, mobile responsive layout, readable dark mode and Roadmap link.
- [ ] Verification of CRUD/file-preview/disposition flows across all four units is still pending and must not be marked PASS based only on builds.

**Implementation boundary:** This is a UI/branding change, not a production deployment or authorization hardening. The local Superadmin special access mode is still enforced according to existing backend configuration and must not be enabled in a real production environment. Roadmap preserves honest distinction between source/build success and operational browser verification.


## R5E UX02 — Original Hero & Simplified Navigation (2026-10-22; Mac build/browser pending)

- [x] R5E UX01 installed, frontend Docker build 30/30 and 3/3 services healthy in Mac report; visual feedback requested reverting its headline and reducing navigation.
- [x] Restored original English brand headline **One Workspace. Full Visibility.** on portal, login and password rotation.
- [x] Condensed header: Portal, Inbox, Tasks, Roadmap; user management under Manage and profile/sign-out under Account. Removed redundant management shortcuts on portal itself.
- [x] Simplified hero and compact four workspace cards; retained previously supplied `public/logo.png` without replacing it.
- [x] Shared footer moved outside portal-only content, uses flex layout to sit at viewport bottom on short pages and after content on long pages, including unit workspaces.
- [ ] Mac installer SHA baseline verification, Go/React Docker build and browser verification (desktop/mobile, dark theme, long scroll, all menus and footer).
- [ ] End-to-end CRUD, attachment previews and dispositions remain unverified in actual browser until tested.

This patch changes frontend and roadmap only. No migrations, database changes, sessions, roles, permission changes, or production deployment assumptions.


## R5E UX03 — Premium Portal Polish (2026-10-22)

- [x] UX02 visual reviewed: original **One Workspace. Full Visibility.** copy and four-workspace layout retained.
- [x] Premium stylesheet prepared: layered navy/steel-blue mesh gradient, subtle geometric lines, gold typography, official `/logo.png` watermark without a bounding box.
- [x] Shared navy/gold line icon treatment, restrained shadow and hover lift for four workspace cards; responsive mobile and dark-theme fallbacks, reduced-motion preference.
- [x] Header polish only; navigation structure, four workspace routes, Roadmap and sticky-bottom footer logic unchanged.
- [ ] Mac: install UX03, run Go/React Docker build and inspect responsive desktop/mobile with actual local branding asset.
- [ ] Browser functional CRUD and dispositions still require live user verification; this UI patch does not validate those workflows.

No backend, migrations, database, accounts, roles, or access-control modifications. No remote fonts or external assets. The existing local branding image `apps/frontend/public/logo.png` is preserved.


## R5E UX03A — Scale & Unit Color Accents (2026-10-22)

- [x] Based on R5E UX03 premium portal and its four existing workspace links, logo watermark and English tagline.
- [x] Increased desktop landing maximum width, hero height, heading size, and workspace card size while preserving the four-card layout.
- [x] Restored original per-unit accents via existing React variables: Urmin teal, Subbagren blue, Subbagsumda purple and Subbagbinfung amber. Tinted icon backgrounds, slim top borders and contextual hover accents.
- [x] Responsive tablet/mobile and dark-theme handling; no remote fonts or external assets.
- [ ] Mac: install checksum-verified UX03A patch, run React/Go Docker build and inspect desktop/mobile visual behavior.
- [ ] Browser E2E for all CRUD/file/disposition workflows remains pending; this is a styling-only patch.

No backend, migrations, DB, credentials, roles or permissions changed; keep `public/logo.png` unchanged.


## R5E UX04 — Interactive Unit Dashboards & Collapsible Sidebar (2026-10-22)

- [x] UX03A portal visually reviewed by user; premium navy/gold, official logo watermark and four per-unit color accents retained.
- [x] Prepared a frontend-only live dashboard for each unit using authenticated existing registry endpoints (Urmin incoming/outgoing/agenda/archive, Subbagren proposals/verified budget, Subbagsumda personnel/training/inventory, Subbagbinfung SOP/PID/RB-SPIP/ABK/training/evaluation, plus R5A unit records).
- [x] Dashboard filters: period 30/90/365 days or all time; click trend buckets, category bars, status legend; filtered recent records, refresh, shortcuts to existing CRUD modules.
- [x] Sidebar UX: desktop full/icon-only collapse and persist locally, mobile drawer remains; accessible labels and tooltips; responsive charts/dark mode/reduced motion.
- [x] Data handling: uses already-permitted read endpoints, does not elevate access; unavailable sources flagged, no demo figures, no data writes, no new dependencies.
- [ ] Verify installer checksum, Mac React/Go build, mobile/desktop sidebar and chart interactions across four units.
- [ ] Browser end-to-end with test records, uploads, dispositions and full reporting still pending until manually verified.

This is a **frontend-only dashboard UX patch**; not a replacement for a purpose-built analytics/materialized reporting API. Trend counts represent accessible records returned by current list endpoints, subject to their limits; a missing permitted source is not silently interpreted as a global zero.


## R5E UX04A — Fixed Footer, Unit Heading Cleanup & Official Naming (2026-10-22)

- [x] UX04 dashboard screenshot reviewed: user requested viewport-pinned footer and removal of duplicate “Workspace Overview” heading.
- [x] Prepared authenticated-app fixed footer with reserved bottom spacing for scrolling content; desktop/sidebar collapse, mobile drawer and sticky header continue independently. Login and password-rotation pages are unchanged.
- [x] Kept individual unit name as the only main heading; analytics controls, KPI cards, interactive charts, filters and quick actions remain.
- [x] Updated visible app brand subtitle, browser title/description and footer to **BagRenmin Densus 88 AT Polri**. Kept **One Workspace. Full Visibility.** as established brand tagline.
- [ ] Mac Go/React build, footer scroll on short/long content, tablet/mobile visual and interactive chart functionality to be verified after installation.

UI/branding-only change. No migrations, DB writes, account or permission updates; roadmap retains actual test status.


## R5E UX04B — Workspace Layout Consistency (2026-10-22; Mac/browser verification pending)

- [x] Unified workspace shell: header Inbox and Tasks now open inside the selected unit's persistent sidebar/layout, with current workspace context retained and sidebar collapse unchanged.
- [x] Redesigned the shared Berkas & Disposisi module: tidy searchable register, accessible Add/Edit dialog with visible form controls, and neatly separated attachments, tasks and history.
- [x] Redesigned the distribution inbox: summary counters derived from permitted API data, search/status filters, a responsive list/table and contextual details with existing receive/disposition actions.
- [x] UI changes only; existing protected Go endpoints and database schemas retained.
- [ ] Build/test React on Mac and verify all internal routes retain sidebar, including header Inbox/Tasks and switching among units; check collapse persistence, mobile drawer, dark mode, footer.
- [ ] Browser CRUD and disposition flow: create, edit, search, upload/open, send, receive, complete, archive and refresh are still pending manual validation.

This visual change is not a production-readiness or browser E2E approval.


## R5F — Fokus penyelesaian URMIN (dibekukan untuk tiga unit lainnya)

- **R5F1 Dashboard Urmin**: KPI berbasis sumber existing, Action Center tugas sesuai akun, tren surat masuk/keluar, status disposisi, agenda, dan tautan ke modul sumber. **Siap diuji di Mac; E2E browser pending**.
- **R5F2 Inbox Distribusi**: verifikasi role penerima, penerimaan, file dan histori. Pending.
- **R5F3 Tugas Disposisi**: issue/receive/forward/review/final approval + skenario role lengkap. Pending.
- **R5F4 Surat Masuk/Keluar**: nomor, status, lampiran dan riwayat. Pending.
- **R5F5 Agenda/Arsip**: CRUD, foto/PDF, referensi dan permission. Pending.
- **R5F6 Urmin Acceptance**: uji nyata via browser beberapa role, eskalasi, klasifikasi, audit dan regresi; baru kemudian tandai Urmin final. Pending.

Tiga unit lain tidak dikembangkan lebih lanjut sampai milestone Urmin selesai. Dashboard hanya menampilkan record yang boleh diakses akun, dan angka dari endpoint list terbatas tidak boleh diklaim statistik keseluruhan organisasi.
