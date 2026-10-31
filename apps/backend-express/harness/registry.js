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
  { n: 33, mount: 'sumda', method: 'GET', path: '/api/v1/subbagsumda/registry/', actors: ['kasubbagsumda'] },
  { n: 34, mount: 'sumda', method: 'POST', path: '/api/v1/subbagsumda/registry/', actors: ['kasubbagsumda'], safety: 'probe' },
  { n: 35, mount: 'sumda', method: 'GET', path: '/api/v1/subbagsumda/registry/{id}', params: { id: 'sumdaId' }, actors: ['kasubbagsumda'] },
  { n: 36, mount: 'sumda', method: 'PATCH', path: '/api/v1/subbagsumda/registry/{id}', params: { id: 'sumdaId' }, actors: ['kasubbagsumda'] },
  { n: 37, mount: 'sumda', method: 'DELETE', path: '/api/v1/subbagsumda/registry/{id}', params: { id: 'sumdaId' }, actors: ['kasubbagsumda'] },

  // ---- 5.6 /api/v1/subbagbinfung/registry (5) ----
  { n: 38, mount: 'binfung', method: 'GET', path: '/api/v1/subbagbinfung/registry/', actors: ['kasubbagbinfung'] },
  { n: 39, mount: 'binfung', method: 'POST', path: '/api/v1/subbagbinfung/registry/', actors: ['kasubbagbinfung'], safety: 'probe' },
  { n: 40, mount: 'binfung', method: 'GET', path: '/api/v1/subbagbinfung/registry/{id}', params: { id: 'binfungId' }, actors: ['kasubbagbinfung'] },
  { n: 41, mount: 'binfung', method: 'PATCH', path: '/api/v1/subbagbinfung/registry/{id}', params: { id: 'binfungId' }, actors: ['kasubbagbinfung'] },
  { n: 42, mount: 'binfung', method: 'DELETE', path: '/api/v1/subbagbinfung/registry/{id}', params: { id: 'binfungId' }, actors: ['kasubbagbinfung'] },

  // ---- 5.7 /api/v1/urmin/registry (9) — surat keluar ----
  { n: 43, mount: 'urmin-registry', method: 'GET', path: '/api/v1/urmin/registry/', actors: ['kaUrmin'] },
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
