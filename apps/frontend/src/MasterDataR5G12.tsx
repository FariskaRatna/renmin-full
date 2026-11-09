import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { confirmDialog, showToast } from './UIFeedback'
import { Pager, usePaged } from './PaginationR5H5'
import './MasterDataR5G12.css'

/**
 * R5G12: pengelolaan master data persuratan oleh Superadmin.
 *
 * Himpunan yang dikelola, atas keputusan pemilik sistem:
 *
 *   Jenis Surat  -> ND = Nota Dinas, dst.   (segmen 1b nomor surat)
 *   Kode Arsip   -> HUM.1.2. = BUKU TAMU    (segmen 4 nomor surat)
 *   Disposisi    -> MONITOR = Monitor, dst. (centang lembar disposisi arahan, R5H2)
 *   Enam pilihan dropdown Surat Keluar (R5H3, migrasi 042): jalur, penandatangan,
 *   pemberi nomor, verifikator, tembusan, tipe surat.
 *
 * Derajat dan klasifikasi SENGAJA tidak ada di sini. Derajat terikat CHECK
 * constraint di tabel surat masuk sehingga "bisa dikelola" hanya akan jadi
 * ilusi — menambah nilai ketiga tetap menuntut migrasi. Klasifikasi menentukan
 * siapa boleh membuka dokumen, jadi menjadikannya data yang bisa disunting
 * berarti satu salah klik di sini menggeser hak akses di empat unit sekaligus.
 */

type Row = { code: string; name: string }
type SetKey = 'jenis-surat' | 'kode-arsip' | 'disposisi' | 'jalur-surat' | 'penandatangan' | 'pemberi-nomor' | 'verifikator' | 'tembusan' | 'tipe-surat'

const SETS: { key: SetKey; title: string; blurb: string; codeLabel: string; codeHint: string; nameLabel: string }[] = [
  {
    key: 'jenis-surat',
    title: 'Jenis Surat',
    blurb: 'Mengisi bagian kedua segmen pertama nomor surat, misalnya ND pada B/ND.',
    codeLabel: 'Kode',
    codeHint: 'Huruf besar dan angka, boleh garis miring. Contoh: ND',
    nameLabel: 'Nama jenis surat',
  },
  {
    key: 'kode-arsip',
    title: 'Kode Arsip',
    blurb: 'Mengisi segmen keempat nomor surat, misalnya HUM.1.2. Petugas mencarinya dengan mengetik nama perkaranya.',
    codeLabel: 'Kode',
    codeHint: 'Pola berjenjang diakhiri titik. Contoh: HUM.1.2.',
    nameLabel: 'Nama perkara',
  },
  {
    key: 'disposisi',
    title: 'Disposisi',
    blurb: 'Pilihan centang "Disposisi Kabagrenmin" pada lembar arahan, misalnya Monitor atau Arsipkan.',
    codeLabel: 'Kode',
    codeHint: 'Huruf besar, angka, garis bawah; diawali huruf. Contoh: MONITOR',
    nameLabel: 'Nama disposisi',
  },
  {
    key: 'jalur-surat',
    title: 'Jalur Surat',
    blurb: 'Pilihan "Jalur Surat" pada formulir Surat Keluar.',
    codeLabel: 'Kode',
    codeHint: 'Huruf besar, angka, garis bawah; diawali huruf. Contoh: INTERNAL',
    nameLabel: 'Nama jalur',
  },
  {
    key: 'penandatangan',
    title: 'Pemberi Tanda Tangan',
    blurb: 'Pilihan "Pemberi Tanda Tangan" pada formulir Surat Keluar.',
    codeLabel: 'Kode',
    codeHint: 'Huruf besar, angka, garis bawah; diawali huruf. Contoh: INTERNAL',
    nameLabel: 'Nama jabatan',
  },
  {
    key: 'pemberi-nomor',
    title: 'Pemberi Nomor',
    blurb: 'Pilihan "Pemberi Nomor" pada formulir Surat Keluar.',
    codeLabel: 'Kode',
    codeHint: 'Huruf besar, angka, garis bawah; diawali huruf. Contoh: INTERNAL',
    nameLabel: 'Nama unit/jabatan',
  },
  {
    key: 'verifikator',
    title: 'Verifikator Tambahan',
    blurb: 'Pilihan "Verifikator Tambahan" (boleh lebih dari satu). Nama tidak boleh memuat koma.',
    codeLabel: 'Kode',
    codeHint: 'Huruf besar, angka, garis bawah; diawali huruf. Contoh: INTERNAL',
    nameLabel: 'Nama jabatan',
  },
  {
    key: 'tembusan',
    title: 'Tembusan',
    blurb: 'Pilihan "Tembusan" (boleh lebih dari satu). Nama tidak boleh memuat koma.',
    codeLabel: 'Kode',
    codeHint: 'Huruf besar, angka, garis bawah; diawali huruf. Contoh: INTERNAL',
    nameLabel: 'Nama tujuan tembusan',
  },
  {
    key: 'tipe-surat',
    title: 'Tipe Surat',
    blurb: 'Pilihan "Tipe Surat" pada formulir Surat Keluar.',
    codeLabel: 'Kode',
    codeHint: 'Huruf besar, angka, garis bawah; diawali huruf. Contoh: INTERNAL',
    nameLabel: 'Nama tipe surat',
  },
]

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') {
    const csrf = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    if (!csrf.ok) throw new Error('Sesi berakhir. Silakan masuk kembali.')
    const { csrfToken } = await csrf.json() as { csrfToken: string }
    headers['X-CSRF-Token'] = csrfToken
    if (body !== undefined) headers['Content-Type'] = 'application/json'
  }
  const response = await fetch(url, {
    method, credentials: 'same-origin', cache: 'no-store', headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const e: { error?: string } = await response.json().catch(() => ({}))
    throw new Error(
      e.error === 'duplicate' ? 'Kode atau nama itu sudah ada.'
      : e.error === 'invalid_code' ? 'Format kodenya tidak sesuai.'
      : e.error === 'invalid_name' ? 'Nama harus 2 karakter atau lebih.'
      : e.error === 'code_in_use' ? 'Kode ini masih dipakai surat atau arahan yang tercatat, jadi belum bisa dihapus.'
      : e.error === 'code_immutable' ? 'Kode tidak dapat diubah. Hapus lalu buat baru bila memang perlu.'
      : e.error === 'not_found' ? 'Datanya sudah tidak ada.'
      : response.status === 403 ? 'Hanya Superadmin yang dapat mengelola master data.'
      : 'Permintaan belum berhasil. Silakan coba lagi.')
  }
  return response.json() as Promise<T>
}

function MasterSet({ spec }: { spec: typeof SETS[number] }) {
  const [rows, setRows] = useState<Row[]>([])

  // R5H5: paginasi seperti menu Disposisi.
  const {pageItems:pagedRows,pager}=usePaged(rows,[rows.length])
  const [limited, setLimited] = useState(false)
  const [search, setSearch] = useState('')
  const [state, setState] = useState<'loading'|'ready'|'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const seq = useRef(0)
  const alive = useRef(true)

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = useCallback(async (q: string) => {
    const mine = ++seq.current
    setState('loading')
    try {
      const d = await call<{items:Row[];limited:boolean}>(`/api/v1/admin/master/${spec.key}?q=${encodeURIComponent(q)}`)
      if (!alive.current || seq.current !== mine) return
      setRows(d.items); setLimited(d.limited); setState('ready')
    } catch (e) {
      if (!alive.current || seq.current !== mine) return
      setState('error'); showToast(e instanceof Error ? e.message : 'Gagal memuat', 'error')
    }
  }, [spec.key])

  useEffect(() => { void load('') }, [load])

  async function add(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await call(`/api/v1/admin/master/${spec.key}`, 'POST', { code: newCode.trim(), name: newName.trim() })
      showToast(`${spec.title} berhasil ditambahkan.`, 'success')
      setNewCode(''); setNewName('')
      await load(search)
    } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal menambah', 'error') }
    finally { if (alive.current) setBusy(false) }
  }

  async function saveEdit(row: Row) {
    if (busy) return
    setBusy(true)
    try {
      await call(`/api/v1/admin/master/${spec.key}/${encodeURIComponent(row.code)}`, 'PATCH',
        { code: row.code, name: editName.trim() })
      showToast('Nama berhasil diperbarui.', 'success')
      setEditing(null)
      await load(search)
    } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal menyimpan', 'error') }
    finally { if (alive.current) setBusy(false) }
  }

  async function remove(row: Row) {
    if (busy) return
    const ok = await confirmDialog(
      `Hapus ${row.code} — ${row.name}? Surat yang terlanjur memakai kode ini tidak ikut berubah, tapi kodenya akan kehilangan keterangan di master.`,
      { confirmLabel: 'Hapus', danger: true })
    if (!ok) return
    setBusy(true)
    try {
      await call(`/api/v1/admin/master/${spec.key}/${encodeURIComponent(row.code)}`, 'DELETE')
      showToast('Data berhasil dihapus.', 'success')
      await load(search)
    } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal menghapus', 'error') }
    finally { if (alive.current) setBusy(false) }
  }

  return <section className="panel sdl-master">
    <div className="sdl-master__head">
      <div>
        <h3>{spec.title}</h3>
        <p>{spec.blurb}</p>
      </div>
      <form className="sdl-master__search" onSubmit={e=>{e.preventDefault();void load(search)}} role="search">
        <input value={search} maxLength={100} onChange={e=>setSearch(e.target.value)} placeholder={`Cari ${spec.title.toLowerCase()}...`} aria-label={`Cari ${spec.title}`}/>
        <button type="submit" className="btn" disabled={busy}>Cari</button>
        {search && <button type="button" className="btn" onClick={()=>{setSearch('');void load('')}}>Reset</button>}
      </form>
    </div>

    <form className="sdl-master__add" onSubmit={add}>
      <label><span>{spec.codeLabel}</span>
        <input value={newCode} required maxLength={16} onChange={e=>setNewCode(e.target.value)} placeholder={spec.codeHint}/>
      </label>
      <label><span>{spec.nameLabel}</span>
        <input value={newName} required minLength={2} maxLength={250} onChange={e=>setNewName(e.target.value)} placeholder="Nama lengkap"/>
      </label>
      <button type="submit" className="btn primary" disabled={busy||!newCode.trim()||newName.trim().length<2}>Tambah</button>
    </form>

    {limited && <p className="sdl-master__limit">Menampilkan 200 data teratas. Pakai pencarian untuk mempersempit.</p>}

    {state === 'loading' ? <div className="sdl-master__empty" role="status">Memuat...</div>
      : state === 'error' ? <div className="sdl-master__empty" role="alert">Data belum bisa dimuat. <button type="button" className="btn" onClick={()=>void load(search)}>Coba Lagi</button></div>
      : rows.length === 0 ? <div className="sdl-master__empty">Belum ada data yang cocok.</div>
      : <div className="table-scroll"><table className="data-table sdl-master__table"><thead><tr><th>Kode</th><th>Nama</th><th className="sdl-master__actions-head">Aksi</th></tr></thead><tbody>
          {pagedRows.map(r => <tr key={r.code}>
            <td><code>{r.code}</code></td>
            <td>{editing === r.code
              ? <input className="sdl-master__inline" value={editName} maxLength={250} autoFocus onChange={e=>setEditName(e.target.value)}/>
              : r.name}</td>
            <td><div className="sdl-master__actions">
              {editing === r.code
                ? <>
                    <button type="button" className="btn primary" disabled={busy||editName.trim().length<2} onClick={()=>void saveEdit(r)}>Simpan</button>
                    <button type="button" className="btn" disabled={busy} onClick={()=>setEditing(null)}>Batal</button>
                  </>
                : <>
                    <button type="button" className="btn" disabled={busy} onClick={()=>{setEditing(r.code);setEditName(r.name)}}>Ubah Nama</button>
                    <button type="button" className="btn" disabled={busy} onClick={()=>void remove(r)}>Hapus</button>
                  </>}
            </div></td>
          </tr>)}
        </tbody></table></div>}<Pager pager={pager} label="data"/>
  </section>
}

export default function MasterDataR5G12() {
  return <div className="sdl-master__wrap">
    <section className="panel sdl-master__intro">
      <h2>Master Data Persuratan</h2>
      <p>
        Dua daftar yang mengisi nomor surat dinas. Menambah di sini langsung terpakai di formulir
        Surat Keluar tanpa perlu menunggu pembaruan aplikasi.
      </p>
      <p className="sdl-master__note">
        <strong>Derajat</strong> (Biasa, Kilat) dan <strong>Klasifikasi</strong> (Biasa, Penting) tidak
        dikelola di sini. Keduanya terikat aturan database: derajat dipakai tabel surat masuk, dan
        klasifikasi menentukan siapa boleh membuka dokumen.
      </p>
    </section>
    {SETS.map(spec => <MasterSet key={spec.key} spec={spec}/>)}
  </div>
}
