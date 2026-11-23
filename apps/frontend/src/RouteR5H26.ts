/**
 * R5H26 (2026-11-22): alamat bersih untuk navigasi aplikasi.
 *
 * Sebelumnya seluruh navigasi hanya state `screen` di App.tsx: URL tidak pernah berubah, sehingga
 * tombol Back/Forward browser tidak bekerja, refresh selalu kembali ke Portal, dan halaman tidak
 * bisa dibagikan sebagai tautan. Modul ini memetakan Screen <-> path (tanpa `#`), contoh:
 *
 *   /                                   Portal
 *   /urmin/surat-masuk/daftar?id=…      Urmin -> Surat Masuk, tab Daftar, rekaman tertentu
 *   /subbagren                          Subbagren (pilihan PROGAR/DALGAR)
 *   /subbagren/dalgar/myinterest        Subbagren DALGAR -> Data myinterest
 *   /subbagren/progar/surat-masuk       menu internal `__surat-masuk` (awalan __ tidak ditulis)
 *   /subbagren/inbox, /subbagren/tugas  Inbox dan Disposisi/Tugas dalam konteks unit
 *   /arahan, /dashboard, /profil, /admin/pengguna, /admin/role, /admin/master-data, …
 *
 * Server tidak perlu diubah: Vite (di belakang Caddy) sudah mengembalikan index.html untuk path
 * yang bukan berkas (SPA fallback), dan path halaman tidak bertabrakan dengan /api/* maupun
 * pola SDL_EXPRESS_PATHS. Ini NAVIGASI saja; hak akses tetap diperiksa backend dan aturan
 * pengalihan di navigate() (Kabagrenmin, Superadmin) tetap berlaku untuk alamat yang diketik.
 */

export type RouteView = 'portal' | 'executive' | 'arahan' | 'inbox' | 'tasks' | 'workspace' | 'roadmap' | 'security' | 'roles' | 'users' | 'master' | 'delegations' | 'profile' | 'login-preview'
export type RouteUnit = 'urmin' | 'ren' | 'sumda' | 'binfung'
export type RouteSub = 'progar' | 'pagu'
export type RouteScreen = { view: RouteView; unit?: RouteUnit; menu?: string; tab?: string; recordID?: string; create?: boolean; sub?: RouteSub }

const UNIT_SLUG: Record<RouteUnit, string> = { urmin: 'urmin', ren: 'subbagren', sumda: 'subbagsumda', binfung: 'subbagbinfung' }
const SUB_SLUG: Record<RouteSub, string> = { progar: 'progar', pagu: 'dalgar' }
const VIEW_PATH: Partial<Record<RouteView, string>> = {
  executive: 'dashboard', arahan: 'arahan', roadmap: 'roadmap', security: 'admin/kewenangan', roles: 'admin/role',
  users: 'admin/pengguna', master: 'admin/master-data', delegations: 'delegasi', profile: 'profil', 'login-preview': 'login-preview',
}
const UNIT_VIEW_SLUG = { inbox: 'inbox', tasks: 'tugas' } as const
const enc = encodeURIComponent

/** Screen -> path + query. Nilai kosong tidak ditulis supaya alamat tetap pendek. */
export function screenToUrl(s: RouteScreen): string {
  const q = new URLSearchParams()
  if (s.recordID) q.set('id', s.recordID)
  if (s.create) q.set('baru', '1')
  const query = q.toString() ? `?${q.toString()}` : ''
  if (s.view === 'portal') return `/${query}`
  const fixed = VIEW_PATH[s.view]
  if (fixed) return `/${fixed}${query}`
  const unit = s.unit ? UNIT_SLUG[s.unit] : ''
  if (s.view === 'inbox' || s.view === 'tasks') return `/${unit ? `${unit}/` : ''}${UNIT_VIEW_SLUG[s.view]}${query}`
  // workspace
  const parts = [unit]
  if (s.unit === 'ren' && s.sub) parts.push(SUB_SLUG[s.sub])
  if (s.menu) parts.push(enc(s.menu.replace(/^__/, '')))
  if (s.menu && s.tab) parts.push(enc(s.tab))
  return `/${parts.filter(Boolean).join('/')}${query}`
}

/**
 * path + query -> Screen, atau null bila alamatnya tidak dikenal (pemanggil jatuh ke Portal).
 * `menuIds(unit)` = id menu yang sah untuk unit itu; slug yang tidak ada di sana dianggap menu
 * internal berawalan `__` (mis. "surat-masuk" di Subbagren = `__surat-masuk`).
 */
export function urlToScreen(pathname: string, search: string, menuIds: (u: RouteUnit) => string[]): RouteScreen | null {
  const seg = pathname.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x) } catch { return x } })
  const q = new URLSearchParams(search)
  const extra: Partial<RouteScreen> = {}
  const id = q.get('id'); if (id) extra.recordID = id
  if (q.get('baru') === '1') extra.create = true
  if (!seg.length) return { view: 'portal', ...extra }
  const joined = seg.join('/')
  const fixed = (Object.entries(VIEW_PATH) as [RouteView, string][]).find(([, p]) => p === joined)
  if (fixed) return { view: fixed[0], ...extra }
  const unit = (Object.entries(UNIT_SLUG) as [RouteUnit, string][]).find(([, slug]) => slug === seg[0])?.[0]
  if (!unit) {
    // /inbox dan /tugas tanpa unit: pakai unit workspace terakhir (diisi navigate()).
    if (seg.length === 1 && seg[0] === UNIT_VIEW_SLUG.inbox) return { view: 'inbox', ...extra }
    if (seg.length === 1 && seg[0] === UNIT_VIEW_SLUG.tasks) return { view: 'tasks', ...extra }
    return null
  }
  let rest = seg.slice(1)
  if (rest.length === 1 && rest[0] === UNIT_VIEW_SLUG.inbox) return { view: 'inbox', unit, ...extra }
  if (rest.length === 1 && rest[0] === UNIT_VIEW_SLUG.tasks) return { view: 'tasks', unit, ...extra }
  const out: RouteScreen = { view: 'workspace', unit, ...extra }
  if (unit === 'ren') {
    const sub = (Object.entries(SUB_SLUG) as [RouteSub, string][]).find(([, slug]) => slug === rest[0])?.[0]
    if (sub) { out.sub = sub; rest = rest.slice(1) }
  }
  if (rest[0]) {
    const ids = menuIds(unit)
    out.menu = ids.includes(rest[0]) ? rest[0] : `__${rest[0]}`
    if (rest[1]) out.tab = rest[1]
  }
  if (rest.length > 2) return null
  return out
}
