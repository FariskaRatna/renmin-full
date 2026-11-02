/**
 * Registry 142 endpoint, bernomor sesuai docs/API-CONTRACT.md 5.
 *
 * Bentuk tiap entri:
 *   n        nomor di kontrak, 1..142
 *   mount    grup, menentukan subfolder golden
 *   method   GET | POST | PUT | PATCH | DELETE
 *   path     template; {name} diisi dari fixture atau daftar enumerasi
 *   params   {param} -> kunci fixture di HarnessDb.loadFixtures()
 *   expand   {param} -> daftar nilai literal; satu kasus per nilai
 *   actors   aktor bersesi yang menjalankan endpoint ini; anonim selalu ditambahkan
 *   body     body JSON; default untuk mutation adalah {} (probe validasi)
 *   safety   paksa kelas keamanan, kalau penggolongan otomatis tidak tepat
 *   variant  menandai entri sebagai kasus TAMBAHAN untuk endpoint yang sama;
 *            lihat "Varian jalur sukses" di bawah
 *   note     catatan yang ikut tersimpan di golden file
 *
 * Kelas keamanan menentukan kapan sebuah panggilan boleh dijalankan:
 *
 *   read     GET. Selalu aman, selalu dijalankan.
 *   probe    mutation pada path koleksi dengan body sengaja tidak valid.
 *            Tujuannya merekam bentuk respons validasi (400), bukan mengubah data.
 *   mutating mutation yang menyasar record nyata (punya path param) atau DELETE.
 *            Hanya berjalan kalau SDL_HARNESS_ALLOW_MUTATIONS=true.
 *
 * Aktor anonim dikecualikan: tanpa sesi, request selalu berhenti di gerbang
 * autentikasi sebelum menyentuh data, jadi aman untuk semua kelas.
 *
 * ## Varian jalur sukses
 *
 * Entri dasar di bawah memakai body `{}`, sehingga hampir semua POST/PATCH
 * berhenti di validasi (400). Itu disengaja dan tetap bernilai — bentuk respons
 * validasi ikut dikontrak — tapi akibatnya transisi status, optimistic locking,
 * dan maker-checker tidak pernah dijalankan sama sekali.
 *
 * Jalur sukses ditambahkan sebagai entri BARU dengan `n` yang sama plus
 * `variant`, bukan dengan mengganti body entri dasar. Dua alasan:
 *
 *   1. Mengganti body dasar membuang cakupan validasi 400 yang sudah ada.
 *   2. Mutasi yang berhasil mengubah data yang dibaca endpoint lain (hitungan
 *      di /executive/v2/overview, daftar, konsolidasi). Entri dasar yang
 *      berhasil akan menggeser golden file yang sudah terbukti cocok.
 *
 * Karena itu varian dijalankan di FASE TERAKHIR, sesudah seluruh kasus dasar
 * selesai (lihat buildCases di run.js). Golden file lama tidak tersentuh;
 * varian hanya menambah berkas baru.
 *
 * Varian selalu berkelas `mutating` dan tidak pernah dijalankan aktor anonim —
 * tanpa sesi hasilnya identik dengan entri dasar, jadi hanya duplikasi.
 *
 * Satu varian idealnya menyasar RECORD-nya sendiri yang ditanam
 * seed-documents.js pada state yang tepat. Berbagi record antar varian membuat
 * `version` di body bergantung pada urutan eksekusi — persis kerapuhan yang
 * ingin dihindari.
 */

const UNITS = ['urmin', 'subbagren', 'subbagsumda', 'subbagbinfung']

export function classify(endpoint) {
  if (endpoint.safety) return endpoint.safety
  // Varian jalur sukses selalu menulis, termasuk yang ber-method GET (dipakai
  // untuk membaca ulang hasil mutasi di fase tulis). Digolongkan mutating
  // supaya ikut terkunci di balik SDL_HARNESS_ALLOW_MUTATIONS.
  if (endpoint.variant) return 'mutating'
  if (endpoint.method === 'GET') return 'read'
  if (endpoint.method === 'DELETE') return 'mutating'
  return endpoint.params && Object.keys(endpoint.params).length > 0 ? 'mutating' : 'probe'
}

export const REGISTRY = [
  // ---- 5.1 Root (tidak di bawah /api, tidak lewat proxy Vite) ----
  { n: 1, mount: 'root', method: 'GET', path: '/healthz', actors: [] },
  { n: 2, mount: 'root', method: 'GET', path: '/readyz', actors: [] },

  // ---- 5.2 /api/v1 ----
  { n: 3, mount: 'system', method: 'GET', path: '/api/v1/system/status', actors: [] },

  // ---- 5.3 /api/v1/auth (15) ----
  { n: 4, mount: 'auth', method: 'GET', path: '/api/v1/auth/csrf', actors: [] },
  { n: 5, mount: 'auth', method: 'GET', path: '/api/v1/auth/bootstrap-status', actors: [] },
  {
    n: 6, mount: 'auth', method: 'GET', path: '/api/v1/auth/captcha', actors: [],
    note: 'id dan nonce berubah tiap panggilan; keduanya dinormalisasi',
  },
  {
    n: 7, mount: 'auth', method: 'POST', path: '/api/v1/auth/login', actors: [], safety: 'probe',
    note: 'body kosong -> 400 invalid_request. Login nyata diuji terpisah lewat loginWithPassword',
  },
  { n: 8, mount: 'auth', method: 'POST', path: '/api/v1/auth/verify-otp', actors: [], safety: 'probe' },
  { n: 9, mount: 'auth', method: 'GET', path: '/api/v1/auth/me', actors: ['kaUrmin', 'superadmin'] },
  {
    n: 10, mount: 'auth', method: 'POST', path: '/api/v1/auth/logout', actors: [], safety: 'mutating',
    note: 'mencabut sesi aktor; jangan jalankan dengan sesi yang masih dipakai',
  },
  { n: 11, mount: 'auth', method: 'POST', path: '/api/v1/auth/change-password', actors: [], safety: 'probe' },
  { n: 12, mount: 'auth', method: 'GET', path: '/api/v1/auth/profile', actors: ['kaUrmin'] },
  { n: 13, mount: 'auth', method: 'PATCH', path: '/api/v1/auth/profile', actors: ['kaUrmin'], safety: 'probe' },
  { n: 14, mount: 'auth', method: 'GET', path: '/api/v1/auth/profile/avatar', actors: ['kaUrmin'] },
  { n: 15, mount: 'auth', method: 'PUT', path: '/api/v1/auth/profile/avatar', actors: ['kaUrmin'], safety: 'probe' },
  { n: 16, mount: 'auth', method: 'DELETE', path: '/api/v1/auth/profile/avatar', actors: ['kaUrmin'] },
  { n: 17, mount: 'auth', method: 'POST', path: '/api/v1/auth/profile/email/start', actors: ['kaUrmin'], safety: 'probe' },
  { n: 18, mount: 'auth', method: 'POST', path: '/api/v1/auth/profile/email/verify', actors: ['kaUrmin'], safety: 'probe' },

  // ---- 5.4 /api/v1/unit-work (13) · engine B ----
  {
    n: 19, mount: 'unit-work', method: 'GET', path: '/api/v1/unit-work/{unit}/people',
    expand: { unit: UNITS }, actors: ['kaUrmin', 'kasubbagren'],
  },
  {
    n: 20, mount: 'unit-work', method: 'GET', path: '/api/v1/unit-work/{unit}/records',
    expand: { unit: UNITS }, actors: ['kaUrmin', 'kasubbagren', 'kasubbagsumda', 'kasubbagbinfung'],
  },
  {
    n: 21, mount: 'unit-work', method: 'POST', path: '/api/v1/unit-work/{unit}/records',
    expand: { unit: UNITS }, actors: ['kaUrmin'], safety: 'probe',
  },
  {
    n: 22, mount: 'unit-work', method: 'GET', path: '/api/v1/unit-work/{unit}/records/{id}',
    expand: { unit: ['urmin'] }, params: { id: 'unitWorkRecordId' }, actors: ['kaUrmin'],
  },
  {
    n: 23, mount: 'unit-work', method: 'PATCH', path: '/api/v1/unit-work/{unit}/records/{id}',
    expand: { unit: ['urmin'] }, params: { id: 'unitWorkRecordId' }, actors: ['kaUrmin'],
  },
  {
    n: 24, mount: 'unit-work', method: 'DELETE', path: '/api/v1/unit-work/{unit}/records/{id}',
    expand: { unit: ['urmin'] }, params: { id: 'unitWorkRecordId' }, actors: ['kaUrmin'],
  },
  {
    n: 25, mount: 'unit-work', method: 'POST', path: '/api/v1/unit-work/{unit}/records/{id}/files',
    expand: { unit: ['urmin'] }, params: { id: 'unitWorkRecordId' }, actors: ['kaUrmin'],
    note: 'multipart; probe JSON hanya merekam penolakan bentuk',
  },
  {
    n: 26, mount: 'unit-work', method: 'GET', path: '/api/v1/unit-work/{unit}/records/{id}/files/{fileID}',
    expand: { unit: ['urmin'] }, params: { id: 'unitWorkRecordId', fileID: 'unitWorkFileId' }, actors: ['kaUrmin'],
  },
  {
    n: 27, mount: 'unit-work', method: 'DELETE', path: '/api/v1/unit-work/{unit}/records/{id}/files/{fileID}',
    expand: { unit: ['urmin'] }, params: { id: 'unitWorkRecordId', fileID: 'unitWorkFileId' }, actors: ['kaUrmin'],
  },
  {
    n: 28, mount: 'unit-work', method: 'POST', path: '/api/v1/unit-work/{unit}/records/{id}/tasks',
    expand: { unit: ['urmin'] }, params: { id: 'unitWorkRecordId' }, actors: ['kaUrmin'],
  },
  {
    n: 29, mount: 'unit-work', method: 'POST', path: '/api/v1/unit-work/{unit}/records/{id}/tasks/{taskID}/receive',
    expand: { unit: ['urmin'] }, params: { id: 'unitWorkRecordId', taskID: 'unitWorkTaskId' }, actors: ['kaUrmin'],
  },
  {
    n: 30, mount: 'unit-work', method: 'POST', path: '/api/v1/unit-work/{unit}/records/{id}/tasks/{taskID}/complete',
    expand: { unit: ['urmin'] }, params: { id: 'unitWorkRecordId', taskID: 'unitWorkTaskId' }, actors: ['kaUrmin'],
  },
  {
    n: 31, mount: 'unit-work', method: 'POST', path: '/api/v1/unit-work/{unit}/records/{id}/tasks/{taskID}/cancel',
    expand: { unit: ['urmin'] }, params: { id: 'unitWorkRecordId', taskID: 'unitWorkTaskId' }, actors: ['kaUrmin'],
  },

  // ---- 5.5 /api/v1/subbagsumda/registry (6) ----
  { n: 32, mount: 'sumda', method: 'GET', path: '/api/v1/subbagsumda/registry/ranks', actors: ['kasubbagsumda'] },
  // `?kind=` wajib: tanpanya handler berhenti di 400 invalid_kind dan seluruh
  // daftar — pemetaan kolom, decode JSONB `fields`, penyaringan Engine B per
  // baris — tidak pernah dijalankan. Keluarga yang sama dengan `?year=` pada
  // endpoint 61/62/72.
  { n: 33, mount: 'sumda', method: 'GET', path: '/api/v1/subbagsumda/registry/?kind=personel', actors: ['kasubbagsumda'] },
  { n: 34, mount: 'sumda', method: 'POST', path: '/api/v1/subbagsumda/registry/', actors: ['kasubbagsumda'], safety: 'probe' },
  { n: 35, mount: 'sumda', method: 'GET', path: '/api/v1/subbagsumda/registry/{id}', params: { id: 'sumdaId' }, actors: ['kasubbagsumda'] },
  { n: 36, mount: 'sumda', method: 'PATCH', path: '/api/v1/subbagsumda/registry/{id}', params: { id: 'sumdaId' }, actors: ['kasubbagsumda'] },
  { n: 37, mount: 'sumda', method: 'DELETE', path: '/api/v1/subbagsumda/registry/{id}', params: { id: 'sumdaId' }, actors: ['kasubbagsumda'] },

  // ---- 5.6 /api/v1/subbagbinfung/registry (5) ----
  { n: 38, mount: 'binfung', method: 'GET', path: '/api/v1/subbagbinfung/registry/?kind=sop', actors: ['kasubbagbinfung'] },
  { n: 39, mount: 'binfung', method: 'POST', path: '/api/v1/subbagbinfung/registry/', actors: ['kasubbagbinfung'], safety: 'probe' },
  { n: 40, mount: 'binfung', method: 'GET', path: '/api/v1/subbagbinfung/registry/{id}', params: { id: 'binfungId' }, actors: ['kasubbagbinfung'] },
  { n: 41, mount: 'binfung', method: 'PATCH', path: '/api/v1/subbagbinfung/registry/{id}', params: { id: 'binfungId' }, actors: ['kasubbagbinfung'] },
  { n: 42, mount: 'binfung', method: 'DELETE', path: '/api/v1/subbagbinfung/registry/{id}', params: { id: 'binfungId' }, actors: ['kasubbagbinfung'] },

  // ---- 5.7 /api/v1/urmin/registry (9) — surat keluar ----
  { n: 43, mount: 'urmin-registry', method: 'GET', path: '/api/v1/urmin/registry/?kind=surat_keluar', actors: ['kaUrmin'] },
  { n: 44, mount: 'urmin-registry', method: 'POST', path: '/api/v1/urmin/registry/', actors: ['kaUrmin'], safety: 'probe' },
  { n: 45, mount: 'urmin-registry', method: 'GET', path: '/api/v1/urmin/registry/{id}', params: { id: 'urminRegistryId' }, actors: ['kaUrmin'] },
  { n: 46, mount: 'urmin-registry', method: 'PATCH', path: '/api/v1/urmin/registry/{id}', params: { id: 'urminRegistryId' }, actors: ['kaUrmin'] },
  { n: 47, mount: 'urmin-registry', method: 'DELETE', path: '/api/v1/urmin/registry/{id}', params: { id: 'urminRegistryId' }, actors: ['kaUrmin'] },
  { n: 48, mount: 'urmin-registry', method: 'GET', path: '/api/v1/urmin/registry/{id}/workflow', params: { id: 'urminRegistryId' }, actors: ['kaUrmin'] },
  { n: 49, mount: 'urmin-registry', method: 'POST', path: '/api/v1/urmin/registry/{id}/submit', params: { id: 'urminRegistryId' }, actors: ['kaUrmin'] },
  { n: 50, mount: 'urmin-registry', method: 'POST', path: '/api/v1/urmin/registry/{id}/approve', params: { id: 'urminRegistryId' }, actors: ['kabagrenmin'] },
  { n: 51, mount: 'urmin-registry', method: 'POST', path: '/api/v1/urmin/registry/{id}/reject', params: { id: 'urminRegistryId' }, actors: ['kabagrenmin'] },

  // ---- 5.8 /api/v1/subbagren/usulan (10) · engine A ----
  { n: 52, mount: 'usulan', method: 'GET', path: '/api/v1/subbagren/usulan/capabilities', actors: ['kasubbagren', 'opSubbagren'] },
  { n: 53, mount: 'usulan', method: 'GET', path: '/api/v1/subbagren/usulan/', actors: ['kasubbagren', 'opSubbagren'] },
  { n: 54, mount: 'usulan', method: 'POST', path: '/api/v1/subbagren/usulan/', actors: ['kasubbagren'], safety: 'probe' },
  { n: 55, mount: 'usulan', method: 'GET', path: '/api/v1/subbagren/usulan/{id}', params: { id: 'proposalId' }, actors: ['kasubbagren'] },
  { n: 56, mount: 'usulan', method: 'PATCH', path: '/api/v1/subbagren/usulan/{id}', params: { id: 'proposalId' }, actors: ['kasubbagren'] },
  { n: 57, mount: 'usulan', method: 'POST', path: '/api/v1/subbagren/usulan/{id}/submit', params: { id: 'proposalId' }, actors: ['kasubbagren'] },
  { n: 58, mount: 'usulan', method: 'POST', path: '/api/v1/subbagren/usulan/{id}/review', params: { id: 'proposalId' }, actors: ['kasubbagren'] },
  { n: 59, mount: 'usulan', method: 'PATCH', path: '/api/v1/subbagren/usulan/{id}/revision', params: { id: 'proposalId' }, actors: ['kasubbagren'] },
  { n: 60, mount: 'usulan', method: 'POST', path: '/api/v1/subbagren/usulan/{id}/resubmit', params: { id: 'proposalId' }, actors: ['kasubbagren'] },
  { n: 61, mount: 'usulan', method: 'GET', path: '/api/v1/subbagren/usulan/consolidation?year=2026', actors: ['kasubbagren'] },

  // ---- 5.9 /api/v1/subbagren/budget (11) · engine A + AES-GCM ----
  // `year` wajib: tanpa query ini handler berhenti di 400 invalid_year dan
  // seluruh perhitungan pagu/realisasi tidak pernah dijalankan.
  { n: 62, mount: 'budget', method: 'GET', path: '/api/v1/subbagren/budget/?year=2026', actors: ['kasubbagren'] },
  { n: 63, mount: 'budget', method: 'GET', path: '/api/v1/subbagren/budget/capabilities', actors: ['kasubbagren'] },
  { n: 64, mount: 'budget', method: 'POST', path: '/api/v1/subbagren/budget/pagu', actors: ['kasubbagren'], safety: 'probe' },
  { n: 65, mount: 'budget', method: 'POST', path: '/api/v1/subbagren/budget/pagu/{id}/review', params: { id: 'paguId' }, actors: ['kasubbagren'] },
  { n: 66, mount: 'budget', method: 'POST', path: '/api/v1/subbagren/budget/realisasi', actors: ['kasubbagren'], safety: 'probe' },
  { n: 67, mount: 'budget', method: 'POST', path: '/api/v1/subbagren/budget/realisasi/{id}/review', params: { id: 'realisasiId' }, actors: ['kasubbagren'] },
  { n: 68, mount: 'budget', method: 'GET', path: '/api/v1/subbagren/budget/realisasi/{id}/evidence', params: { id: 'realisasiId' }, actors: ['kasubbagren'] },
  { n: 69, mount: 'budget', method: 'POST', path: '/api/v1/subbagren/budget/realisasi/{id}/evidence', params: { id: 'realisasiId' }, actors: ['kasubbagren'] },
  {
    n: 70, mount: 'budget', method: 'GET',
    path: '/api/v1/subbagren/budget/realisasi/{id}/evidence/{proofId}/download',
    params: { id: 'realisasiId', proofId: 'evidenceId' }, actors: ['kasubbagren'],
    note: 'dekripsi AES-256-GCM envelope SDL1; body direkam sebagai sha256 + panjang',
  },
  {
    n: 71, mount: 'budget', method: 'POST',
    path: '/api/v1/subbagren/budget/realisasi/{id}/evidence/{proofId}/review',
    params: { id: 'realisasiId', proofId: 'evidenceId' }, actors: ['kasubbagren'],
  },
  { n: 72, mount: 'budget', method: 'GET', path: '/api/v1/subbagren/budget/reconciliation?year=2026', actors: ['kasubbagren'] },

  // ---- 5.10 /api/v1/portal/posts (3) ----
  {
    n: 73, mount: 'portal', method: 'GET', path: '/api/v1/portal/posts/',
    actors: ['kabagrenmin', 'superadmin'],
    note: 'Superadmin boleh membaca di sini (guard ad-hoc), tapi tidak menulis',
  },
  { n: 74, mount: 'portal', method: 'POST', path: '/api/v1/portal/posts/', actors: ['kabagrenmin', 'superadmin'], safety: 'probe' },
  { n: 75, mount: 'portal', method: 'PUT', path: '/api/v1/portal/posts/{id}', params: { id: 'portalPostId' }, actors: ['kabagrenmin'] },

  // ---- 5.11 /api/v1/executive/v2 (2) ----
  {
    n: 76, mount: 'executive', method: 'GET', path: '/api/v1/executive/v2/access',
    actors: ['kabagrenmin', 'superadmin', 'kaUrmin'],
    note: 'satu-satunya tempat Superadmin boleh membaca data operasional',
  },
  { n: 77, mount: 'executive', method: 'GET', path: '/api/v1/executive/v2/overview?period=90d', actors: ['kabagrenmin', 'superadmin'] },

  // ---- 5.12 /api/v1/leadership/directives (18) ----
  { n: 78, mount: 'directives', method: 'GET', path: '/api/v1/leadership/directives/meta', actors: ['kabagrenmin', 'kaUrmin'] },
  { n: 79, mount: 'directives', method: 'GET', path: '/api/v1/leadership/directives/candidates', actors: ['kabagrenmin'] },
  { n: 80, mount: 'directives', method: 'GET', path: '/api/v1/leadership/directives/draft', actors: ['kabagrenmin'] },
  { n: 81, mount: 'directives', method: 'PUT', path: '/api/v1/leadership/directives/draft', actors: ['kabagrenmin'], safety: 'probe' },
  { n: 82, mount: 'directives', method: 'DELETE', path: '/api/v1/leadership/directives/draft', actors: ['kabagrenmin'] },
  { n: 83, mount: 'directives', method: 'GET', path: '/api/v1/leadership/directives/draft/attachments', actors: ['kabagrenmin'] },
  { n: 84, mount: 'directives', method: 'POST', path: '/api/v1/leadership/directives/draft/attachments', actors: ['kabagrenmin'], safety: 'probe' },
  {
    n: 85, mount: 'directives', method: 'DELETE', path: '/api/v1/leadership/directives/draft/attachments/{fileID}',
    params: { fileID: 'directiveFileId' }, actors: ['kabagrenmin'],
  },
  {
    n: 86, mount: 'directives', method: 'GET', path: '/api/v1/leadership/directives/attachments/{fileID}/download',
    params: { fileID: 'directiveFileId' }, actors: ['kabagrenmin'],
  },
  { n: 87, mount: 'directives', method: 'GET', path: '/api/v1/leadership/directives/inbox', actors: ['kaUrmin', 'kasubbagren'] },
  { n: 88, mount: 'directives', method: 'GET', path: '/api/v1/leadership/directives/sent', actors: ['kabagrenmin'] },
  { n: 89, mount: 'directives', method: 'GET', path: '/api/v1/leadership/directives/notifications', actors: ['kaUrmin'] },
  { n: 90, mount: 'directives', method: 'POST', path: '/api/v1/leadership/directives/', actors: ['kabagrenmin'], safety: 'probe' },
  { n: 91, mount: 'directives', method: 'GET', path: '/api/v1/leadership/directives/{id}', params: { id: 'directiveId' }, actors: ['kabagrenmin', 'kaUrmin'] },
  { n: 92, mount: 'directives', method: 'GET', path: '/api/v1/leadership/directives/{id}/attachments', params: { id: 'directiveId' }, actors: ['kabagrenmin'] },
  { n: 93, mount: 'directives', method: 'POST', path: '/api/v1/leadership/directives/{id}/read', params: { id: 'directiveId' }, actors: ['kaUrmin'] },
  { n: 94, mount: 'directives', method: 'POST', path: '/api/v1/leadership/directives/{id}/acknowledge', params: { id: 'directiveId' }, actors: ['kaUrmin'] },
  { n: 95, mount: 'directives', method: 'POST', path: '/api/v1/leadership/directives/{id}/ack-seen', params: { id: 'directiveId' }, actors: ['kabagrenmin'] },

  // ---- 5.13 /api/v1/urmin/surat-masuk (15) · engine A ----
  { n: 96, mount: 'surat-masuk', method: 'GET', path: '/api/v1/urmin/surat-masuk/capabilities', actors: ['kaUrmin', 'opUrmin', 'stafUrmin'] },
  {
    n: 97, mount: 'surat-masuk', method: 'GET', path: '/api/v1/urmin/surat-masuk/',
    actors: ['kaUrmin', 'opUrmin', 'stafUrmin', 'kabagrenmin'],
    note: 'otorisasi disaring per baris; tiga aktor dengan scope berbeda penting di sini',
  },
  { n: 98, mount: 'surat-masuk', method: 'POST', path: '/api/v1/urmin/surat-masuk/', actors: ['opUrmin'], safety: 'probe' },
  { n: 99, mount: 'surat-masuk', method: 'GET', path: '/api/v1/urmin/surat-masuk/{id}', params: { id: 'incomingId' }, actors: ['kaUrmin', 'opUrmin'] },
  { n: 100, mount: 'surat-masuk', method: 'PATCH', path: '/api/v1/urmin/surat-masuk/{id}', params: { id: 'incomingId' }, actors: ['opUrmin'] },
  { n: 101, mount: 'surat-masuk', method: 'POST', path: '/api/v1/urmin/surat-masuk/{id}/register', params: { id: 'incomingId' }, actors: ['opUrmin'] },
  { n: 102, mount: 'surat-masuk', method: 'GET', path: '/api/v1/urmin/surat-masuk/{id}/attachments', params: { id: 'incomingId' }, actors: ['kaUrmin'] },
  { n: 103, mount: 'surat-masuk', method: 'POST', path: '/api/v1/urmin/surat-masuk/{id}/attachments', params: { id: 'incomingId' }, actors: ['opUrmin'] },
  {
    n: 104, mount: 'surat-masuk', method: 'GET',
    path: '/api/v1/urmin/surat-masuk/{id}/attachments/{attachmentId}/download',
    params: { id: 'incomingId', attachmentId: 'attachmentId' }, actors: ['kaUrmin'],
  },
  { n: 105, mount: 'surat-masuk', method: 'GET', path: '/api/v1/urmin/surat-masuk/{id}/recipient-candidates', params: { id: 'incomingId' }, actors: ['kaUrmin'] },
  { n: 106, mount: 'surat-masuk', method: 'GET', path: '/api/v1/urmin/surat-masuk/{id}/distributions', params: { id: 'incomingId' }, actors: ['kaUrmin'] },
  { n: 107, mount: 'surat-masuk', method: 'GET', path: '/api/v1/urmin/surat-masuk/{id}/disposition-tracking', params: { id: 'incomingId' }, actors: ['kaUrmin'] },
  { n: 108, mount: 'surat-masuk', method: 'POST', path: '/api/v1/urmin/surat-masuk/{id}/distributions', params: { id: 'incomingId' }, actors: ['kaUrmin'] },
  {
    n: 109, mount: 'surat-masuk', method: 'POST', path: '/api/v1/urmin/surat-masuk/intake',
    actors: ['opUrmin'], safety: 'probe',
    note: 'endpoint gabungan terbesar (r5f7.go, ~270 baris): create/update + attach + register + distribute dalam satu transaksi',
  },
  { n: 110, mount: 'surat-masuk', method: 'GET', path: '/api/v1/urmin/surat-masuk/{id}/intake', params: { id: 'incomingId' }, actors: ['kaUrmin'] },

  // ---- 5.14 /api/v1/urmin/distribution-inbox (5) ----
  { n: 111, mount: 'distribution-inbox', method: 'GET', path: '/api/v1/urmin/distribution-inbox/', actors: ['kaUrmin', 'opSubbagren'] },
  { n: 112, mount: 'distribution-inbox', method: 'POST', path: '/api/v1/urmin/distribution-inbox/{distributionId}/receive', params: { distributionId: 'distributionId' }, actors: ['kaUrmin'] },
  { n: 113, mount: 'distribution-inbox', method: 'GET', path: '/api/v1/urmin/distribution-inbox/{distributionId}/events', params: { distributionId: 'distributionId' }, actors: ['kaUrmin'] },
  { n: 114, mount: 'distribution-inbox', method: 'GET', path: '/api/v1/urmin/distribution-inbox/{distributionId}/disposition-candidates', params: { distributionId: 'distributionId' }, actors: ['kaUrmin'] },
  { n: 115, mount: 'distribution-inbox', method: 'POST', path: '/api/v1/urmin/distribution-inbox/{distributionId}/dispositions', params: { distributionId: 'distributionId' }, actors: ['kaUrmin'] },

  // ---- 5.15 /api/v1/urmin/dispositions (11) ----
  { n: 116, mount: 'dispositions', method: 'GET', path: '/api/v1/urmin/dispositions/', actors: ['kaUrmin', 'opSubbagren'] },
  { n: 117, mount: 'dispositions', method: 'GET', path: '/api/v1/urmin/dispositions/{taskId}/history', params: { taskId: 'dispositionTaskId' }, actors: ['kaUrmin'] },
  { n: 118, mount: 'dispositions', method: 'POST', path: '/api/v1/urmin/dispositions/{taskId}/accept', params: { taskId: 'dispositionTaskId' }, actors: ['opSubbagren'] },
  { n: 119, mount: 'dispositions', method: 'POST', path: '/api/v1/urmin/dispositions/{taskId}/complete', params: { taskId: 'dispositionTaskId' }, actors: ['opSubbagren'] },
  { n: 120, mount: 'dispositions', method: 'POST', path: '/api/v1/urmin/dispositions/{taskId}/review', params: { taskId: 'dispositionTaskId' }, actors: ['kaUrmin'] },
  { n: 121, mount: 'dispositions', method: 'GET', path: '/api/v1/urmin/dispositions/{taskId}/forward-candidates', params: { taskId: 'dispositionTaskId' }, actors: ['kaUrmin'] },
  { n: 122, mount: 'dispositions', method: 'POST', path: '/api/v1/urmin/dispositions/{taskId}/forward', params: { taskId: 'dispositionTaskId' }, actors: ['kaUrmin'] },
  {
    n: 123, mount: 'dispositions', method: 'GET', path: '/api/v1/urmin/dispositions/leadership',
    actors: ['kabagrenmin', 'kaUrmin'],
    note: 'JEBAKAN URUTAN: di Express harus dideklarasikan sebelum /{taskId}/*',
  },
  { n: 124, mount: 'dispositions', method: 'GET', path: '/api/v1/urmin/dispositions/{taskId}/final-status', params: { taskId: 'dispositionTaskId' }, actors: ['kabagrenmin'] },
  { n: 125, mount: 'dispositions', method: 'POST', path: '/api/v1/urmin/dispositions/{taskId}/submit-final', params: { taskId: 'dispositionTaskId' }, actors: ['kaUrmin'] },
  { n: 126, mount: 'dispositions', method: 'POST', path: '/api/v1/urmin/dispositions/{taskId}/decide-final', params: { taskId: 'dispositionTaskId' }, actors: ['kabagrenmin'] },

  // ---- 5.16 /api/v1/admin (16) · guard AuthorizeRoleEditor ----
  {
    n: 127, mount: 'admin', method: 'GET', path: '/api/v1/admin/permissions',
    actors: ['superadmin', 'kaUrmin'],
    note: 'kaUrmin wajib ditolak: ini membuktikan pemisahan identitas vs operasional',
  },
  { n: 128, mount: 'admin', method: 'GET', path: '/api/v1/admin/roles', actors: ['superadmin', 'kaUrmin'] },
  { n: 129, mount: 'admin', method: 'POST', path: '/api/v1/admin/roles', actors: ['superadmin'], safety: 'probe' },
  { n: 130, mount: 'admin', method: 'PUT', path: '/api/v1/admin/roles/{roleKey}', params: { roleKey: 'roleKey' }, actors: ['superadmin'] },
  { n: 131, mount: 'admin', method: 'GET', path: '/api/v1/admin/project-roadmap', actors: ['superadmin'] },
  { n: 132, mount: 'admin', method: 'PATCH', path: '/api/v1/admin/project-roadmap/{id}', params: { id: 'roadmapId' }, actors: ['superadmin'] },
  {
    n: 133, mount: 'admin', method: 'GET', path: '/api/v1/admin/delegations',
    actors: ['superadmin'], safety: 'read',
    note: 'fail-closed: HandleFunc berlaku untuk SEMUA method, selalu 403',
  },
  { n: 134, mount: 'admin', method: 'POST', path: '/api/v1/admin/delegations/apa-pun', actors: ['superadmin'], safety: 'probe', note: 'wildcard /delegations/* -> 403' },
  { n: 135, mount: 'admin', method: 'GET', path: '/api/v1/admin/delegation-candidates', actors: ['superadmin'], safety: 'read' },
  {
    n: 136, mount: 'admin', method: 'GET', path: '/api/v1/admin/users', actors: ['superadmin', 'kaUrmin'],
    // ORDER BY u.created_at DESC tanpa tiebreaker (users/service.go:136, disalin
    // persis oleh Express). Ke-12 akun seed dibuat dalam satu transaksi sehingga
    // created_at-nya identik, dan Postgres memutus seri sesukanya — urutannya
    // berubah antar eksekusi pada backend yang sama sekalipun.
    unordered: ['users'],
  },
  { n: 137, mount: 'admin', method: 'POST', path: '/api/v1/admin/users', actors: ['superadmin'], safety: 'probe' },
  { n: 138, mount: 'admin', method: 'PATCH', path: '/api/v1/admin/users/{userID}', params: { userID: 'userId' }, actors: ['superadmin'] },
  { n: 139, mount: 'admin', method: 'PUT', path: '/api/v1/admin/users/{userID}/access', params: { userID: 'userId' }, actors: ['superadmin'] },
  { n: 140, mount: 'admin', method: 'GET', path: '/api/v1/admin/units', actors: ['superadmin'] },
  {
    n: 141, mount: 'admin', method: 'GET', path: '/api/v1/admin/audit', actors: ['superadmin'],
    // Audit log append-only: kasus 016 (DELETE avatar) menulis satu event saat
    // capture dan satu lagi saat compare, jadi daftarnya SELALU berbeda satu
    // baris walau kedua backend benar. Dibanding bentuknya saja — rename field
    // tetap tertangkap, isi dan urutannya tidak.
    appendOnly: ['events'],
  },
  {
    n: 142, mount: 'admin', method: 'PATCH', path: '/api/v1/admin/users/{userID}/otp',
    params: { userID: 'userId' }, actors: ['superadmin'],
    note: 'tidak bisa mematikan OTP Superadmin; mustUseOTP mengabaikan nilai DB',
  },
]

/**
 * Varian jalur sukses. Sengaja dipisah dari REGISTRY, bukan disisipkan ke
 * dalamnya: REGISTRY harus tetap berisi persis 142 entri yang memetakan
 * API-CONTRACT.md satu lawan satu, dan pemeriksaan itu adalah satu-satunya
 * pengaman bahwa tidak ada endpoint yang terlupakan.
 *
 * Bentuknya sama dengan entri REGISTRY, ditambah dua field wajib:
 *
 *   n        nomor endpoint yang sudah ada di REGISTRY
 *   variant  nama pendek kebab-case, menjelaskan APA yang dibuktikan kasus ini
 *            ('sunting-draf', 'ajukan', 'tolak-versi-basi'), bukan sekadar 'ok'
 *
 * `actors` di sini TIDAK otomatis ditambahi anonim.
 */
export const VARIANTS = [
  // ---- 5.8 usulan · maker-checker + optimistic locking ----
  //
  // Seluruhnya dijalankan kasubbagren. br_op_subbagren ber-scope 'assigned'
  // sementara handler subbagren tidak pernah mengisi assignedUserIds, jadi ia
  // tidak lolos Engine A untuk satu pun di antaranya — perilaku Go yang sah
  // dan sudah terekam di kasus dasar.
  //
  // `version: 1` benar untuk semuanya karena tiap varian punya record sendiri
  // (seed-documents.js) dan tidak ada yang menyentuhnya lebih dulu.
  {
    n: 56, variant: 'sunting-draf', mount: 'usulan', method: 'PATCH',
    path: '/api/v1/subbagren/usulan/{id}', params: { id: 'proposalUpdateId' },
    actors: ['kasubbagren'],
    body: {
      fiscalYear: 2026,
      sourceUnit: 'Subbagren',
      title: 'Sasaran uji penyuntingan draf (sudah disunting)',
      outputTarget: 'Tersedianya bahan perencanaan hasil penyuntingan',
      proposedBudget: 135000000,
      classification: 'biasa',
      reason: 'Penyesuaian pagu usulan setelah rapat koordinasi.',
      version: 1,
    },
    note: 'record milik op-subbagren disunting kasubbagren lewat scope unit; version naik 1 -> 2',
  },
  {
    n: 57, variant: 'ajukan', mount: 'usulan', method: 'POST',
    path: '/api/v1/subbagren/usulan/{id}/submit', params: { id: 'proposalSubmitId' },
    actors: ['kasubbagren'],
    body: { reason: 'Draf sudah lengkap dan siap diajukan untuk ditelaah.', version: 1 },
    note: 'transisi draft -> submitted',
  },
  {
    n: 58, variant: 'telaah-setuju', mount: 'usulan', method: 'POST',
    path: '/api/v1/subbagren/usulan/{id}/review', params: { id: 'proposalReviewId' },
    actors: ['kasubbagren'],
    body: {
      version: 1,
      decision: 'approved',
      reason: 'Sasaran keluaran dan pagu sudah sesuai dengan rencana kerja.',
    },
    note: 'maker-checker: record milik op-subbagren, ditelaah kasubbagren. Pembuat sendiri akan kena 403 self_review_denied',
  },
  {
    n: 59, variant: 'perbaiki-revisi', mount: 'usulan', method: 'PATCH',
    path: '/api/v1/subbagren/usulan/{id}/revision', params: { id: 'proposalRevisionId' },
    actors: ['kasubbagren'],
    body: {
      fiscalYear: 2026,
      sourceUnit: 'Subbagren',
      title: 'Sasaran uji perbaikan revisi (sudah diperbaiki)',
      outputTarget: 'Tersedianya bahan perencanaan hasil perbaikan revisi',
      proposedBudget: 110000000,
      classification: 'biasa',
      reason: 'Perbaikan sesuai catatan telaah pada rapat sebelumnya.',
      version: 1,
    },
    note: 'revision menuntut created_by == pemanggil (review.go:233), jadi record ini milik kasubbagren',
  },
  {
    n: 60, variant: 'ajukan-ulang', mount: 'usulan', method: 'POST',
    path: '/api/v1/subbagren/usulan/{id}/resubmit', params: { id: 'proposalResubmitId' },
    actors: ['kasubbagren'],
    body: { reason: 'Perbaikan sudah dituntaskan, mohon ditelaah kembali.', version: 1 },
    note: 'menuntut has_revision=true; revisionCount 0 -> 1 dan reviewStatus kembali pending',
  },

  // ---- 5.9 budget · maker-checker + plafon + integritas bukti ----
  //
  // URUTAN DEKLARASI DI BAWAH ADALAH URUTAN EKSEKUSI, dan di sini ia berarti.
  // Berbeda dari usulan yang varian-variannya berdiri sendiri, anggaran
  // BERANTAI: verifikasi realisasi (67) menolak 409 approved_evidence_required
  // kalau buktinya belum disetujui (71). Karena itu 71 dideklarasikan SEBELUM
  // 67, melanggar urutan nomor endpoint dengan sengaja.
  //
  // Pembagian aktor mengikuti maker-checker: kabagrenmin mencatat, kasubbagren
  // memverifikasi. Ketiga handler verifikasi menolak 403
  // 'self_verification_denied' kalau keduanya orang yang sama.
  {
    n: 64, variant: 'daftarkan-pagu', mount: 'budget', method: 'POST',
    path: '/api/v1/subbagren/budget/pagu',
    actors: ['kabagrenmin'],
    bodyFixtures: { proposalId: 'proposalPaguRegisterId' },
    body: {
      amount: 180000000,
      authorizationNumber: 'DIPA-2026-9101',
      authorizationIssuer: 'Biro Perencanaan Polda',
      authorizationDate: '2026-02-10',
      reason: 'Pendaftaran pagu sesuai dokumen otorisasi yang diterima.',
    },
    note: 'menuntut usulan submitted + telaah approved; UNIQUE(proposal_id) menjadikan panggilan kedua 409 pagu_already_registered',
  },
  {
    n: 65, variant: 'verifikasi-pagu', mount: 'budget', method: 'POST',
    path: '/api/v1/subbagren/budget/pagu/{id}/review', params: { id: 'paguVerifyId' },
    actors: ['kasubbagren'],
    body: {
      version: 1,
      decision: 'verified',
      reason: 'Dokumen otorisasi sudah dicocokkan dengan arsip DIPA.',
    },
    note: 'pagu didaftarkan op-subbagren, diverifikasi kasubbagren; status pending -> verified, version 1 -> 2',
  },
  {
    n: 66, variant: 'catat-realisasi', mount: 'budget', method: 'POST',
    path: '/api/v1/subbagren/budget/realisasi',
    actors: ['kabagrenmin'],
    bodyFixtures: { paguId: 'paguRecordId' },
    body: {
      amount: 40000000,
      transactionDate: '2026-04-15',
      evidenceReference: 'SP2D-2026-900101',
      description: 'Pembayaran tahap pertama kegiatan uji pencatatan realisasi.',
      reason: 'Pencatatan realisasi sesuai SP2D yang sudah terbit.',
    },
    note: 'menuntut pagu verified dan tahun transaksi == fiscalYear pagu (409/400 kalau tidak)',
  },
  {
    n: 71, variant: 'setujui-bukti', mount: 'budget', method: 'POST',
    path: '/api/v1/subbagren/budget/realisasi/{id}/evidence/{proofId}/review',
    params: { id: 'realisasiChainId', proofId: 'evidenceChainId' },
    actors: ['kasubbagren'],
    body: {
      version: 1,
      decision: 'approved',
      reason: 'Bukti bayar sudah dicocokkan dengan dokumen sumber.',
    },
    note: 'WAJIB sebelum varian 67: tanpa bukti approved, verifikasi realisasi berhenti di 409 approved_evidence_required',
  },
  {
    n: 67, variant: 'verifikasi-realisasi', mount: 'budget', method: 'POST',
    path: '/api/v1/subbagren/budget/realisasi/{id}/review', params: { id: 'realisasiChainId' },
    actors: ['kasubbagren'],
    body: {
      version: 1,
      decision: 'verified',
      reason: 'Realisasi sudah sesuai bukti bayar yang telah disetujui.',
    },
    note: 'puncak rantai: membuka amplop AES-GCM, mencocokkan sha256 plaintext, lalu menguji plafon 50jt terhadap sisa pagu 200jt',
  },
  {
    n: 69, variant: 'unggah-bukti', mount: 'budget', method: 'POST',
    path: '/api/v1/subbagren/budget/realisasi/{id}/evidence',
    params: { id: 'realisasiEvidenceUploadId' },
    actors: ['kabagrenmin'],
    multipart: [
      { name: 'reason', value: 'Unggah bukti bayar sesuai SP2D yang sudah terbit.' },
      { name: 'file', file: 'pdf', filename: 'bukti-unggah-uji.pdf' },
    ],
    note: 'satu-satunya jalur multipart di mount budget; realisasi sasaran sengaja belum punya bukti sama sekali, karena bukti pending/approved yang sudah ada akan menghentikannya di 409 active_evidence_exists',
  },
  {
    n: 62, variant: 'ringkasan-setelah-rantai', mount: 'budget', method: 'GET',
    path: '/api/v1/subbagren/budget/?year=2026',
    actors: ['kasubbagren'],
    note: 'baca ulang sesudah seluruh rantai: membuktikan verifiedRealization dan remaining benar-benar dihitung ulang, bukan sekadar dibaca dari kolom',
  },

  // ---- 5.12 directives · draf ber-revisi + penerbitan ----
  //
  // Hanya tiga endpoint yang jalur suksesnya belum tersentuh. Endpoint 93, 94,
  // dan 95 (read / acknowledge / ack-seen) sudah menjawab 200 SUNGGUHAN di
  // kasus dasar, karena ketiganya tidak membaca body sama sekali — body `{}`
  // lewat begitu saja ke handler. Menambah varian untuk ketiganya hanya akan
  // menduplikasi kasus yang sudah ada.
  //
  // Berantai, dan terpaksa: draf UNIK per penerbit (UNIQUE issuer_id) dan
  // hanya kabagrenmin yang punya grant Kabagrenmin, jadi keempatnya memakai
  // satu draf yang sama secara bergiliran. Urutannya:
  //   simpan (rev 0->1) -> terbitkan (menghabiskan draf) -> simpan lagi -> hapus
  {
    n: 81, variant: 'simpan-draf', mount: 'directives', method: 'PUT',
    path: '/api/v1/leadership/directives/draft',
    actors: ['kabagrenmin'],
    bodyFixtures: { recipients: ['directiveRecipientId'] },
    body: {
      title: 'Draf arahan uji harness',
      body: 'Seluruh unit agar menyiapkan bahan evaluasi sesuai format yang berlaku.',
      kind: 'umum',
      priority: 'biasa',
      // Format lokal tanpa zona waktu, pola sendiri di draft.go — berbeda dari
      // dueAt pada endpoint 90 yang menuntut RFC3339 penuh.
      dueAt: '2030-01-15T09:00',
      revision: 0,
    },
    note: 'revision 0 menyisipkan draf pertama; respons mengembalikan revision 1',
  },
  {
    n: 90, variant: 'terbitkan', mount: 'directives', method: 'POST',
    path: '/api/v1/leadership/directives/',
    actors: ['kabagrenmin'],
    bodyFixtures: { recipients: ['directiveRecipientId'] },
    body: {
      title: 'Arahan terbit uji harness',
      body: 'Seluruh unit agar melaporkan hasil evaluasi triwulan paling lambat akhir bulan.',
      kind: 'umum',
      priority: 'penting',
      // RFC3339 penuh, dan WAJIB di masa depan (api.go:116). Tahun 2030 dipilih
      // supaya kasus ini tidak membusuk diam-diam saat kalender bergerak.
      dueAt: '2030-02-01T09:00:00Z',
      draftRevision: 1,
    },
    note: 'draftRevision mengunci draf, memindahkan lampiran privat, lalu menghapus draf — semuanya satu transaksi',
  },
  {
    n: 81, variant: 'simpan-draf-ulang', mount: 'directives', method: 'PUT',
    path: '/api/v1/leadership/directives/draft',
    actors: ['kabagrenmin'],
    bodyFixtures: { recipients: ['directiveRecipientId'] },
    body: {
      title: 'Draf arahan uji harness kedua',
      body: 'Draf kedua dibuat ulang sesudah draf pertama habis terpakai saat penerbitan.',
      kind: 'persuratan',
      priority: 'kilat',
      dueAt: '',
      revision: 0,
    },
    note: 'membuktikan draf benar-benar hilang sesudah terbit: revision 0 berhasil lagi, bukan 409',
  },
  {
    n: 82, variant: 'hapus-draf', mount: 'directives', method: 'DELETE',
    path: '/api/v1/leadership/directives/draft',
    actors: ['kabagrenmin'],
    body: { revision: 1 },
    note: 'revisi harus cocok; lampiran privat ikut terhapus di transaksi yang sama',
  },

  // ---- 5.13 surat-masuk · Engine A, scope 'own' lawan 'unit' ----
  //
  // Tiga varian pertama dijalankan op-urmin, yang grant-nya ber-scope 'own'
  // dan berbatas 'biasa'. Ia karena itu hanya lolos untuk surat MILIKNYA
  // SENDIRI yang tidak berklasifikasi 'penting' — berbeda dari kasus usulan
  // yang semuanya dijalankan pemegang scope 'unit'. Justru selisih itu yang
  // ingin diuji di sini.
  //
  // Varian 108 dijalankan ka-urmin karena distribusi menuntut scope 'unit'
  // atas surat milik orang lain.
  //
  // Varian 103 dan 109 adalah dua dari tiga jalur multipart di seluruh API
  // (yang ketiga endpoint 69). Keduanya tetap dijalankan op-urmin: Engine A
  // memeriksa `.attach` terhadap surat dengan status DIPAKSA 'registered'
  // (r5f7.go:243), bukan terhadap status sebenarnya, dan grant 'own' op-urmin
  // tetap menentukan karena surat sasarannya miliknya sendiri.
  {
    n: 98, variant: 'catat-surat', mount: 'surat-masuk', method: 'POST',
    path: '/api/v1/urmin/surat-masuk/',
    actors: ['opUrmin'],
    body: {
      letterNumber: '099/UJI-TULIS/2026',
      sender: 'Biro Perencanaan Polda',
      letterDate: '2026-09-25',
      receivedDate: '2026-09-26',
      subject: 'Surat masuk hasil uji jalur tulis harness',
      classification: 'biasa',
      reason: 'Pencatatan surat masuk yang baru diterima loket.',
    },
    note: 'agenda_no dialokasikan kolom identity; deterministik karena seed memakai RESTART IDENTITY',
  },
  {
    n: 100, variant: 'sunting-draf', mount: 'surat-masuk', method: 'PATCH',
    path: '/api/v1/urmin/surat-masuk/{id}', params: { id: 'incomingEditId' },
    actors: ['opUrmin'],
    body: {
      letterNumber: '011/UJI/2026-REV',
      sender: 'Bagian Perencanaan Polda',
      letterDate: '2026-09-20',
      receivedDate: '2026-09-22',
      subject: 'Sasaran uji penyuntingan surat masuk (sudah disunting)',
      classification: 'biasa',
      reason: 'Perbaikan nomor surat sesuai berkas fisik.',
      version: 1,
    },
    note: 'hanya status draft dan versi cocok yang lolos; version 1 -> 2',
  },
  {
    n: 101, variant: 'daftarkan', mount: 'surat-masuk', method: 'POST',
    path: '/api/v1/urmin/surat-masuk/{id}/register', params: { id: 'incomingRegisterId' },
    actors: ['opUrmin'],
    body: { reason: 'Surat sudah lengkap dan siap didaftarkan ke agenda.', version: 1 },
    note: 'transisi draft -> registered; surat ber-intake justru ditolak 409 use_intake_submission',
  },
  {
    n: 108, variant: 'distribusikan', mount: 'surat-masuk', method: 'POST',
    path: '/api/v1/urmin/surat-masuk/{id}/distributions', params: { id: 'incomingDistributeId' },
    actors: ['kaUrmin'],
    bodyFixtures: { recipientId: 'distributionRecipientId' },
    body: {
      unit: 'subbagren',
      reason: 'Diteruskan ke Subbagren untuk penyiapan bahan jawaban.',
    },
    note: 'penerima wajib punya urmin.distribusi.receive dengan scope unit/assigned; surat warisan tanpa baris intake bebas didistribusikan',
  },
  {
    n: 103, variant: 'unggah-lampiran', mount: 'surat-masuk', method: 'POST',
    path: '/api/v1/urmin/surat-masuk/{id}/attachments', params: { id: 'incomingAttachId' },
    actors: ['opUrmin'],
    multipart: [
      { name: 'file', file: 'pdf', filename: 'lampiran-unggah-uji.pdf' },
      { name: 'reason', value: 'Lampiran berkas fisik surat masuk dipindai dan diunggah.' },
    ],
    note: 'urutan bagian sengaja berkas-dulu-alasan-kemudian: Go membaca FormFile sebelum FormValue (r3b.go:250 lalu :265), jadi kiriman tanpa berkas menjadi 400 file_required — bukan 400 invalid_reason — walau keduanya salah',
  },
  {
    n: 109, variant: 'intake-submit', mount: 'surat-masuk', method: 'POST',
    path: '/api/v1/urmin/surat-masuk/intake',
    actors: ['opUrmin'],
    multipart: [
      {
        name: 'payload',
        // Satu field teks berisi JSON, bukan body JSON. `DisallowUnknownFields`
        // tetap berlaku di dalamnya, jadi field asing di sini pun 400.
        //
        // mode 'submit' + needsDisposition FALSE dipilih dengan sengaja:
        // needsDisposition true memanggil kabagForIntake(), yang menjawab 409
        // kalau Kabagrenmin yang memenuhi syarat bukan tepat satu — hasilnya
        // bergantung pada isi tabel user, bukan pada perbedaan backend.
        value: JSON.stringify({
          id: '',
          version: 0,
          letterNumber: '017/UJI-INTAKE/2026',
          sender: 'Biro Perencanaan Polda',
          letterDate: '2026-09-28',
          receivedDate: '2026-09-29',
          subject: 'Undangan rapat hasil uji intake harness',
          classification: 'biasa',
          reason: 'Pencatatan undangan sekaligus pendaftaran lewat jalur intake.',
          letterKind: 'undangan',
          responseDue: '',
          // letterKind 'undangan' pada mode 'submit' MEWAJIBKAN eventStart
          // (validateFlexible, r5f7.go:96); tanpanya 400 invalid_intake.
          eventStart: '2026-10-05T09:00',
          eventEnd: '2026-10-05T12:00',
          eventLocation: 'Aula Bagrenmin',
          eventAgenda: 'Pembahasan rencana kerja triwulan.',
          details: 'Peserta diminta membawa bahan paparan masing-masing.',
          needsDisposition: false,
          mode: 'submit',
        }),
      },
      { name: 'files', file: 'pdf', filename: 'lampiran-intake-uji.pdf' },
    ],
    note: 'endpoint gabungan terbesar: create + attach + register + metadata intake dalam satu transaksi. Nama field berkasnya `files` (jamak) dan boleh berulang sampai 10 kali — berbeda dari endpoint 69 dan 103 yang memakai `file` tunggal',
  },

  // ---- 5.14 distribution-inbox · engsel menuju disposisi ----
  //
  // Berantai dan urutannya wajib: `currentIssuer()` menuntut distribusinya
  // berstatus 'received', jadi varian 115 MUSTAHIL lolos sebelum varian 112
  // menjalankannya. Itu bukan sekadar urutan UI — ia pemeriksaan sungguhan,
  // dan rantai inilah yang membuktikannya.
  {
    n: 112, variant: 'terima-distribusi', mount: 'distribution-inbox', method: 'POST',
    path: '/api/v1/urmin/distribution-inbox/{distributionId}/receive',
    params: { distributionId: 'inboxDistributionId' },
    actors: ['kasubbagren'],
    body: { reason: 'Distribusi diterima dan akan segera ditindaklanjuti.' },
    note: 'status sent -> received; panggilan kedua menjadi 409 already_received',
  },
  {
    n: 115, variant: 'terbitkan-disposisi', mount: 'distribution-inbox', method: 'POST',
    path: '/api/v1/urmin/distribution-inbox/{distributionId}/dispositions',
    params: { distributionId: 'inboxDistributionId' },
    actors: ['kasubbagren'],
    bodyFixtures: { assigneeId: 'dispositionAssigneeId' },
    body: {
      instruction: 'Mohon siapkan bahan jawaban dan laporkan hasilnya kepada Kasubbagren.',
      // `validDispositionDue` menolak tanggal di masa lalu DAN yang lebih dari
      // setahun ke depan, jadi tanggal tetap di sini pasti membusuk suatu saat.
      // Kalau varian ini tiba-tiba 400 invalid_input, inilah penyebabnya —
      // bukan perubahan perilaku backend.
      dueDate: '2027-06-30',
    },
    note: 'menuntut distribusi sudah received (varian 112) + penerbit != pelaksana; menulis antrean email di transaksi yang sama',
  },

  // ---- 5.15 dispositions · rantai berjenjang sampai persetujuan final ----
  //
  // Sasarannya BUKAN tugas yang dibuat varian 115, melainkan sembilan tugas
  // yang ditanam `seed-documents.js` di atas lima distribusi 'received'
  // tersendiri. Alasannya indeks `sdl_disposition_open_one_idx`: satu tugas
  // terbuka per (distribusi, pelaksana), sementara pelaksananya op-subbagren
  // untuk semuanya.
  //
  // Berbeda dari rantai `budget`, kesembilan varian tugas di sini BERDIRI
  // SENDIRI: masing-masing punya record sendiri pada state yang dituntut
  // handler, jadi `version: 1` selalu benar dan kegagalan satu varian tidak
  // menjatuhkan yang lain. 125 dan 126 memakai akar berbeda justru karena itu
  // — 126 punya baris pengajuan tertanam sendiri dan tidak menunggu 125.
  //
  // Satu-satunya yang benar-benar bergantung urutan adalah 123, dan ia
  // sengaja ditaruh paling akhir: dasbor dibaca SESUDAH seluruh mutasi supaya
  // yang terbukti bukan isi tabel, melainkan bahwa ia ikut bergerak.
  {
    n: 117, variant: 'riwayat-lengkap', mount: 'dispositions', method: 'GET',
    path: '/api/v1/urmin/dispositions/{taskId}/history', params: { taskId: 'dispositionHistoryId' },
    actors: ['kasubbagren'],
    note: 'tugas selesai + sudah ditelaah: tiga event ditambah baris telaah yang disusulkan di ekor daftar, bukan disimpan sebagai event',
  },
  {
    n: 118, variant: 'terima-tugas', mount: 'dispositions', method: 'POST',
    path: '/api/v1/urmin/dispositions/{taskId}/accept', params: { taskId: 'dispositionAcceptId' },
    actors: ['opSubbagren'],
    body: { reason: 'Tugas diterima dan segera dikerjakan sesuai instruksi.', version: 1 },
    note: 'pending -> in_progress; hanya pelaksana, penerbit justru 404',
  },
  {
    n: 119, variant: 'selesaikan-tugas', mount: 'dispositions', method: 'POST',
    path: '/api/v1/urmin/dispositions/{taskId}/complete', params: { taskId: 'dispositionCompleteId' },
    actors: ['opSubbagren'],
    body: { reason: 'Pekerjaan selesai, laporan hasil sudah disampaikan.', version: 1 },
    note: 'in_progress -> completed; anak yang belum ditelaah membuatnya 409 child_tasks_unreviewed',
  },
  {
    n: 120, variant: 'telaah-setuju', mount: 'dispositions', method: 'POST',
    path: '/api/v1/urmin/dispositions/{taskId}/review', params: { taskId: 'dispositionReviewId' },
    actors: ['kasubbagren'],
    body: {
      decision: 'approved',
      reason: 'Hasil pekerjaan sudah sesuai instruksi dan dapat diterima.',
      version: 1,
    },
    note: 'satu telaah permanen per tugas; panggilan kedua 409 review_already_exists',
  },
  {
    n: 121, variant: 'calon-penerusan', mount: 'dispositions', method: 'GET',
    path: '/api/v1/urmin/dispositions/{taskId}/forward-candidates',
    params: { taskId: 'dispositionCandidatesId' },
    actors: ['opSubbagren'],
    note: 'penerbit dan pelaksana induk diblokir dispositionPathUsers; yang tersisa hanya staf-subbagren',
  },
  {
    n: 122, variant: 'teruskan-berjenjang', mount: 'dispositions', method: 'POST',
    path: '/api/v1/urmin/dispositions/{taskId}/forward', params: { taskId: 'dispositionForwardId' },
    actors: ['opSubbagren'],
    bodyFixtures: { assigneeId: 'dispositionForwardTargetId' },
    body: {
      instruction: 'Mohon lanjutkan penyiapan bahan dan laporkan kepada saya.',
      // Harus di masa depan, dalam satu tahun, DAN tidak melewati tenggat
      // induk (2027-12-31) — tiga batas sekaligus. Kalau varian ini tiba-tiba
      // 400 invalid_input, tanggal inilah yang membusuk, bukan backend-nya.
      dueDate: '2027-06-30',
      version: 1,
    },
    note: 'depth 0 -> 1, versi INDUK ikut naik; tenggat anak melewati induk ditolak 409 child_due_after_parent',
  },
  {
    n: 124, variant: 'status-final-belum-diajukan', mount: 'dispositions', method: 'GET',
    path: '/api/v1/urmin/dispositions/{taskId}/final-status',
    params: { taskId: 'dispositionFinalStatusId' },
    actors: ['kabagrenmin'],
    note: 'akar selesai + telaah disetujui tapi belum diajukan: approval not_submitted, progress 90% dan readyForSubmission true',
  },
  {
    n: 125, variant: 'ajukan-final', mount: 'dispositions', method: 'POST',
    path: '/api/v1/urmin/dispositions/{taskId}/submit-final',
    params: { taskId: 'dispositionSubmitFinalId' },
    actors: ['kasubbagren'],
    body: {
      reason: 'Seluruh tugas pada kasus ini telah selesai dan ditelaah.',
      version: 1,
    },
    note: 'menuntut DUA permission (review + final.submit) dan seluruh rantai completed+approved',
  },
  {
    n: 126, variant: 'putuskan-final', mount: 'dispositions', method: 'POST',
    path: '/api/v1/urmin/dispositions/{taskId}/decide-final',
    params: { taskId: 'dispositionDecideFinalId' },
    actors: ['kabagrenmin'],
    body: {
      decision: 'approved',
      reason: 'Hasil kasus disetujui dan dinyatakan selesai.',
      version: 1,
    },
    note: 'version di sini milik baris persetujuan, BUKAN tugasnya; pimpinan yang pernah menyentuh rantainya ditolak 403 self_approval_denied',
  },
  {
    n: 123, variant: 'dasbor-sesudah-keputusan', mount: 'dispositions', method: 'GET',
    path: '/api/v1/urmin/dispositions/leadership',
    actors: ['kabagrenmin'],
    note: 'sengaja PALING AKHIR: membuktikan dasbor memantulkan hasil 120/125/126, bukan sekadar membaca tabel',
  },

  // ---- 5.4 unit-work · ENGINE B, mutasi pertama yang pernah berhasil ----
  //
  // Engine B menopang 33 endpoint di empat mount dan sampai sebelum varian ini
  // **belum pernah dijalankan oleh satu pun mutasi yang berhasil**. Ia tidak
  // memakai `permission_key` sama sekali: scope grant (`own`/`assigned`/`unit`)
  // dicocokkan LANGSUNG dengan verb. Yang dibuktikan di bawah:
  //
  //   create/edit/delete/assign  → scope `unit` (ka-urmin) lolos atas berkas
  //                                milik orang lain (op-urmin, scope `own`)
  //   read                       → staf-urmin ber-scope `own` lolos atas berkas
  //                                orang lain SEMATA karena ada tugas untuknya
  //
  // Cabang kedua itu yang paling mudah salah diporting: ia satu-satunya tempat
  // Engine B melihat ke tabel LAIN (sdl_unit_work_tasks) sebelum memutuskan.
  {
    n: 21, variant: 'buat-berkas', mount: 'unit-work', method: 'POST',
    path: '/api/v1/unit-work/urmin/records',
    actors: ['kaUrmin'],
    body: {
      category: 'Persuratan',
      title: 'Berkas kerja baru hasil uji jalur tulis',
      description: 'Dibuat lewat varian harness untuk membuktikan jalur create Engine B.',
      classification: 'biasa',
    },
    note: 'scope own ATAU unit boleh membuat; pemiliknya otomatis pemanggil',
  },
  {
    n: 23, variant: 'sunting-berkas', mount: 'unit-work', method: 'PATCH',
    path: '/api/v1/unit-work/urmin/records/{id}', params: { id: 'workUpdateId' },
    actors: ['kaUrmin'],
    body: {
      category: 'Persuratan',
      // Judul dan kategori SENGAJA tidak berubah: keduanya penanda fixture.
      // Yang disunting hanya deskripsi.
      title: 'Berkas uji penyuntingan unit-work',
      description: 'Deskripsi sudah disunting lewat jalur tulis harness.',
      classification: 'biasa',
      version: 1,
    },
    note: 'version 1 -> 2; versi basi menjadi 409 stale_version lewat WHERE version=$8, bukan pemeriksaan terpisah',
  },
  {
    n: 22, variant: 'baca-sesudah-sunting', mount: 'unit-work', method: 'GET',
    path: '/api/v1/unit-work/urmin/records/{id}', params: { id: 'workUpdateId' },
    actors: ['kaUrmin'],
    note: 'respons 23 hanya {ok:true}; hanya pembacaan ulang ini yang membuktikan deskripsi dan version benar-benar berubah, berikut baris event-nya',
  },
  {
    n: 24, variant: 'hapus-berkas', mount: 'unit-work', method: 'DELETE',
    path: '/api/v1/unit-work/urmin/records/{id}', params: { id: 'workDeleteId' },
    actors: ['kaUrmin'],
    note: 'soft-delete; berkas dengan tugas pending/received justru 409 active_disposition — itu yang direkam kasus dasar',
  },
  {
    n: 28, variant: 'tugaskan', mount: 'unit-work', method: 'POST',
    path: '/api/v1/unit-work/urmin/records/{id}/tasks', params: { id: 'workAssignId' },
    actors: ['kaUrmin'],
    bodyFixtures: { to: 'workAssigneeId' },
    body: {
      instruction: 'Mohon tindak lanjuti berkas kerja ini dan laporkan hasilnya.',
      dueDate: '2027-06-30',
    },
    note: 'penerima diuji kelayakannya lewat query terpisah (403 recipient_not_allowed), bukan lewat permit()',
  },
  {
    n: 29, variant: 'terima-tugas', mount: 'unit-work', method: 'POST',
    path: '/api/v1/unit-work/urmin/records/{id}/tasks/{taskID}/receive',
    params: { id: 'workReceiveId', taskID: 'taskReceiveId' },
    actors: ['stafUrmin'],
    body: { response: 'Tugas diterima dan akan segera dikerjakan.' },
    note: 'staf-urmin ber-scope own atas berkas MILIK ORANG LAIN: lolos read hanya karena ada tugas untuknya',
  },
  {
    n: 30, variant: 'selesaikan-tugas', mount: 'unit-work', method: 'POST',
    path: '/api/v1/unit-work/urmin/records/{id}/tasks/{taskID}/complete',
    params: { id: 'workCompleteId', taskID: 'taskCompleteId' },
    actors: ['stafUrmin'],
    body: { response: 'Tugas selesai dikerjakan dan hasilnya sudah dilaporkan.' },
    note: 'hanya transisi ini yang mewajibkan response 3..1000 (400 response_required)',
  },
  {
    n: 31, variant: 'batalkan-tugas', mount: 'unit-work', method: 'POST',
    path: '/api/v1/unit-work/urmin/records/{id}/tasks/{taskID}/cancel',
    params: { id: 'workCancelId', taskID: 'taskCancelId' },
    actors: ['kaUrmin'],
    body: { response: 'Tugas dibatalkan karena berkasnya ditarik kembali.' },
    note: 'dibatalkan PEMBERI tugas, bukan penerimanya — satu-satunya transisi yang menuntut who == from_user',
  },

  // ---- 5.7 urmin-registry · surat keluar, dari draf sampai keputusan ----
  //
  // Rantai lengkapnya: buat → sunting → baca ulang → ajukan → baca workflow →
  // setujui / tolak. Dua pasang bergantung urutan dan tidak boleh dibalik:
  // 45 sesudah 46, dan 48/51 sesudah 49 yang bersangkutan.
  //
  // Catatan penting: `urminregisterOwned` menolak lewat `errUrminRegisterDenied`
  // yang dipetakan ke 403, sedangkan register yang tidak ada menjadi 404 —
  // dua jalur yang gampang tertukar saat memporting.
  {
    n: 44, variant: 'buat-register', mount: 'urmin-registry', method: 'POST',
    path: '/api/v1/urmin/registry/',
    actors: ['kaUrmin'],
    body: {
      kind: 'surat_keluar',
      code: 'SK-2026-920',
      title: 'Surat keluar baru hasil uji jalur tulis',
      classification: 'biasa',
      fields: {
        nomorSurat: 'SK/920/XI/2026',
        tujuan: 'Kepala Bagian Perencanaan Polda',
        tanggalSurat: '2026-10-01',
        perihal: 'Permohonan data dukung perencanaan',
        sifatSurat: 'Biasa',
        statusAdministrasi: 'Draft',
        keterangan: 'Dibuat lewat jalur tulis harness.',
      },
    },
    note: 'SATU transaksi menulis tiga tabel: work record, register, dan baris workflow surat keluar. Kode ganda menjadi 409 duplicate_code lewat pemetaan SQLSTATE 23505',
  },
  {
    n: 46, variant: 'sunting-register', mount: 'urmin-registry', method: 'PATCH',
    path: '/api/v1/urmin/registry/{id}', params: { id: 'registryUpdateId' },
    actors: ['kaUrmin'],
    body: {
      kind: 'surat_keluar',
      // Kode dan judul tidak berubah: `ref_code` adalah penanda fixture, dan
      // mengubahnya akan membuat varian ini mencari baris yang salah di run
      // berikutnya.
      code: 'SK-2026-911',
      title: 'Surat keluar uji penyuntingan',
      classification: 'biasa',
      fields: {
        nomorSurat: 'SK/911/XI/2026',
        tujuan: 'Kepala Bagian Perencanaan Polda',
        tanggalSurat: '2026-10-01',
        perihal: 'Permintaan data dukung perencanaan (sudah disunting)',
        sifatSurat: 'Biasa',
        statusAdministrasi: 'Draft',
        keterangan: 'Keterangan sudah disunting lewat jalur tulis harness.',
      },
      version: 1,
    },
    note: 'melewati lockOutgoingEditing karena tahapnya masih draft; tahap submitted/approved menjadi 409 outgoing_locked',
  },
  {
    n: 45, variant: 'baca-sesudah-sunting', mount: 'urmin-registry', method: 'GET',
    path: '/api/v1/urmin/registry/{id}', params: { id: 'registryUpdateId' },
    actors: ['kaUrmin'],
    note: 'membuktikan fields JSONB benar-benar tersimpan dan ter-decode ulang; respons 46 hanya {ok:true}',
  },
  {
    n: 47, variant: 'hapus-register', mount: 'urmin-registry', method: 'DELETE',
    path: '/api/v1/urmin/registry/{id}', params: { id: 'registryDeleteId' },
    actors: ['kaUrmin'],
    note: 'menghapus register DAN berkas kerja pasangannya dalam satu transaksi',
  },
  {
    n: 49, variant: 'ajukan', mount: 'urmin-registry', method: 'POST',
    path: '/api/v1/urmin/registry/{id}/submit', params: { id: 'registrySubmitId' },
    actors: ['kaUrmin'],
    body: { version: 1, note: 'Konsep surat sudah lengkap dan siap ditelaah pimpinan.' },
    note: 'tiga gerbang: tujuan wajib terisi (409 recipient_required), minimal satu PDF (409 pdf_required_before_submit), versi workflow cocok',
  },
  {
    n: 48, variant: 'workflow-sesudah-pengajuan', mount: 'urmin-registry', method: 'GET',
    path: '/api/v1/urmin/registry/{id}/workflow', params: { id: 'registrySubmitId' },
    actors: ['kabagrenmin'],
    note: 'dibaca PIMPINAN sesudah varian 49: canSubmit jadi false, canReview jadi true, dan baris event submitted muncul. Kasus dasarnya 404 karena fixture-nya sudah dihapus endpoint 47',
  },
  {
    n: 50, variant: 'setujui', mount: 'urmin-registry', method: 'POST',
    path: '/api/v1/urmin/registry/{id}/approve', params: { id: 'registryApproveId' },
    actors: ['kabagrenmin'],
    body: { version: 2, note: 'Konsep surat disetujui untuk ditandatangani.' },
    note: 'sasarannya ditanam sudah submitted dengan content_sha256 yang dihitung JavaScript. 200 di sini = Go, Express, dan seed sepakat soal digest; 409 document_integrity_changed = rumus hash-nya meleset. Varian inilah yang membongkar B8 (503 akibat $2 bertipe ganda), diperbaiki 2026-11-01 di kedua backend',
  },
  {
    n: 49, variant: 'ajukan-untuk-ditolak', mount: 'urmin-registry', method: 'POST',
    path: '/api/v1/urmin/registry/{id}/submit', params: { id: 'registryRejectId' },
    actors: ['kaUrmin'],
    body: { version: 1, note: 'Konsep surat diajukan untuk telaah pimpinan.' },
    note: 'pasangan 51: di sini hash-nya dihitung backend sendiri, jadi rantai submit -> decide terbukti bulat tanpa bergantung pada seed',
  },
  {
    n: 51, variant: 'tolak', mount: 'urmin-registry', method: 'POST',
    path: '/api/v1/urmin/registry/{id}/reject', params: { id: 'registryRejectId' },
    actors: ['kabagrenmin'],
    body: { version: 2, note: 'Konsep surat dikembalikan untuk diperbaiki redaksinya.' },
    note: 'penolakan menuntut catatan minimal 8 karakter; persetujuan tidak. Versi 2 karena varian 49 sudah menaikkannya dari 1',
  },
]

const VARIANT_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Pemeriksaan integritas: nomor harus unik dan lengkap 1..142. */
export function assertRegistryComplete() {
  const seen = new Set()
  for (const endpoint of REGISTRY) {
    if (endpoint.variant) {
      throw new Error(`entri n=${endpoint.n} punya variant; varian tempatnya di VARIANTS`)
    }
    if (seen.has(endpoint.n)) throw new Error(`nomor endpoint ganda: ${endpoint.n}`)
    seen.add(endpoint.n)
  }
  const missing = []
  for (let n = 1; n <= 142; n++) if (!seen.has(n)) missing.push(n)
  if (missing.length > 0) {
    throw new Error(`endpoint belum terdaftar di registry: ${missing.join(', ')}`)
  }
  if (REGISTRY.length !== 142) {
    throw new Error(`registry berisi ${REGISTRY.length} entri, seharusnya 142`)
  }

  // Varian: nomornya harus merujuk endpoint yang ada, namanya unik per endpoint,
  // dan aktornya eksplisit — varian tanpa aktor bersesi tidak menulis apa pun.
  const seenVariants = new Set()
  for (const variant of VARIANTS) {
    if (!seen.has(variant.n)) {
      throw new Error(`varian menunjuk endpoint n=${variant.n} yang tidak ada di registry`)
    }
    if (!variant.variant || !VARIANT_NAME_RE.test(variant.variant)) {
      throw new Error(`varian n=${variant.n} butuh nama kebab-case, dapat: ${variant.variant}`)
    }
    const key = `${variant.n}#${variant.variant}`
    if (seenVariants.has(key)) throw new Error(`varian ganda: ${key}`)
    seenVariants.add(key)
    if (!variant.actors || variant.actors.length === 0) {
      throw new Error(`varian ${key} tidak punya aktor bersesi; ia tidak akan menguji apa pun`)
    }
  }
}
