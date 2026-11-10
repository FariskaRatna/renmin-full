import { confirmDialog, showToast } from './UIFeedback'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import './SumdaR5B.css'
import './UrminR5D.css'
import './SuratKeluarR5F9.css'
import './SuratMasukStatusR5H5.css'
import { Pager, usePaged } from './PaginationR5H5'

type Kind = 'surat_keluar' | 'agenda' | 'arsip'
type OutgoingStatus = 'all' | 'draft' | 'submitted' | 'approved' | 'rejected' | 'legacy'
const outgoingTabs: {id:OutgoingStatus;label:string}[]=[
 {id:'all',label:'Semua'}, {id:'draft',label:'Draft'},
 {id:'submitted',label:'Menunggu Approval'}, {id:'approved',label:'Disetujui'},
 {id:'rejected',label:'Perlu Revisi'}, {id:'legacy',label:'Perlu Verifikasi'}
]
const workflowLabel:Record<string,string>={draft:'Draft',submitted:'Menunggu Approval',approved:'Disetujui · Menunggu TTE',rejected:'Perlu Revisi',legacy:'Perlu Verifikasi'}
// R5H5: label ringkas untuk DAFTAR, memakai badge yang sama dengan Surat Masuk.
// Label lengkap (workflowLabel) tetap di detail dan di tooltip badge.
const workflowListLabel:Record<string,string>={draft:'Draft',submitted:'Menunggu Approval',approved:'Disetujui',rejected:'Perlu Revisi',legacy:'Perlu Verifikasi'}
const workflowTone:Record<string,string>={draft:'neutral',submitted:'warn',approved:'ok',rejected:'danger',legacy:'info'}
function outgoingStatus(item:Entry) {return item.workflowStatus || 'draft'}
type WorkflowDetail={status:string;version:number;canSubmit:boolean;canReview:boolean;signingAvailable:boolean;emailDeliveryAvailable:boolean;events:{id:string;action:string;actor:string;note:string;at:string}[]}
type Entry = { id: string; kind: Kind; code: string; title: string; classification: 'biasa' | 'penting'; fields: Record<string, string>; workRecordId: string; version: number; createdAt: string; workflowStatus?:string }
type Field = { key: string; label: string; input?: 'number' | 'date' | 'select' | 'textarea' | 'multi' | 'kodearsip' | 'jenissurat' | 'nomorsurat'; choices?: string[]; placeholder?: string }
/** R5G10: satu baris master kode arsip (endpoint 147). */
type KodeArsip = { code: string; name: string; depth: number }

/**
 * R5G4: pilihan "Yang Menghadiri" — jabatan, bukan akun orang.
 *
 * Daftarnya sengaja TETAP, tidak ditarik dari API. Empat unitnya ditanam di
 * migrasi 001 dan tidak pernah berubah, sedangkan satu-satunya endpoint yang
 * menyebutkannya (#140 GET /admin/units) berada di balik guard Superadmin —
 * akun operasional yang mengisi agenda tidak akan pernah bisa memanggilnya.
 *
 * Tingkatnya subbag, bukan paur: satu subbag terdiri dari beberapa paur, jadi
 * memilih subbag sudah mencakup paur di bawahnya. Kalau kelak paur perlu
 * dipilih satu per satu, nama-namanya harus didaftarkan dulu — saat ini tidak
 * ada satu pun paur di dalam sistem.
 */
const JABATAN_HADIR = ['Kabagrenmin', 'Urmin', 'Subbagren', 'Subbagsumda', 'Subbagbinfung']
type StoredFile = { id: string; name: string; mediaType: string; size: number; createdAt: string; purpose?: 'pendukung' }
type QueuedFile = { id: string; file: File; url: string }
type FilePreview = { name: string; mime: string; url: string; temporary: boolean }
type Draft = { kind: Kind; code: string; title: string; classification: 'biasa' | 'penting'; fields: Record<string, string>; version: number }
type Glyph = 'plus' | 'search' | 'refresh' | 'edit' | 'archive' | 'attachment' | 'close' | 'check' | 'surat_keluar' | 'agenda' | 'arsip' | 'arrow' | 'info' | 'list' | 'shield' | 'calendar' | 'image' | 'file' | 'eye' | 'trash' | 'upload'

const symbols: Record<Glyph, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/></>,
  edit: <><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L9 17l-4 1 1-4z"/></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v12h14V9m-10 4h6"/></>,
  attachment: <><path d="M9 12.5 16.5 5a3.2 3.2 0 0 1 4.5 4.5L10.5 20a5.5 5.5 0 0 1-7.8-7.8L13 2"/></>,
  close: <path d="M5 5 19 19M19 5 5 19"/>,
  check: <path d="m4 12 5 5L20 6"/>,
  surat_keluar: <><path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/></>,
  agenda: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18"/></>,
  arsip: <><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v12h14V9m-10 4h6"/></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
  info: <><circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10h.01"/></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/></>,
  shield: <><path d="m12 2 9 4v6c0 6-4 9-9 11-5-2-9-5-9-11V6z"/><path d="m9 12 2 2 4-4"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18"/></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="9" r="2"/><path d="m3 18 6-6 4 4 3-3 5 5"/></>,
  file: <><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
  trash: <><path d="M4 7h16M10 7V4h4v3M6 7l1 14h10l1-14M10 11v6m4-6v6"/></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4"/></>
}
function Icon({name, size=18}: {name: Glyph; size?: number}) { return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{symbols[name]}</svg> }

const schema: Record<Kind, { title: string; singular: string; code: string; name: string; icon: Glyph; helper: string; fields: Field[] }> = {
  // R5G9: "Jenis Surat" ditambahkan paling depan, "Tujuan" menjadi "Kepada",
  // "Sifat" menjadi "Derajat", dan "Keterangan" tidak lagi ditampilkan.
  //
  // Dua rename itu hanya mengganti LABEL; kuncinya tetap `tujuan` dan
  // `sifatSurat`. Mengganti kunci berarti seluruh surat keluar yang sudah ada
  // kehilangan isiannya, dan tidak ada yang meminta itu.
  //
  // `keterangan` menghilang dari layar tapi kuncinya tetap diterima backend —
  // mencabutnya dari allowlist akan membuat surat lama gagal disunting.
  //
  // R5H3: isian ditambah dan diurutkan ulang sesuai permintaan pemilik sistem.
  // Kunci lama TIDAK berubah, hanya labelnya (tanggalSurat -> Tanggal Naskah
  // Dinas, kodeArsip -> KKA). Delapan kunci baru diterima backend lewat
  // allowlist urmin_register.go. Pilihannya TIDAK ditulis di sini: `choices`
  // kosong diisi saat layar dimuat (lihat useSuratKeluarChoices) dari master
  // data (/urmin/surat-opsi) dan dari surat masuk / arahan yang nyata.
  surat_keluar: {title:'Surat Keluar',singular:'Surat Keluar',code:'Kode Register Internal',name:'Hal / Tentang Surat',icon:'surat_keluar',helper:'',fields:[
    // Arahan lebih dulu: memilihnya mengisi Rujukan Surat (useSuratKeluarChoices).
    // R5H6: label 'Rujukan Disposisi' (permintaan pemilik); kuncinya tetap rujukanArahan.
    {key:'rujukanArahan',label:'Rujukan Disposisi',input:'select',choices:[]},
    {key:'rujukanSurat',label:'Rujukan Surat',input:'select',choices:[]},
    {key:'tanggalSurat',label:'Tanggal Naskah Dinas',input:'date'},
    {key:'jalurSurat',label:'Jalur Surat',input:'select',choices:[]},
    {key:'penandatangan',label:'Pemberi Tanda Tangan',input:'select',choices:[]},
    {key:'pemberiNomor',label:'Pemberi Nomor',input:'select',choices:[]},
    {key:'verifikator',label:'Verifikator Tambahan',input:'multi',choices:[]},
    {key:'tembusan',label:'Tembusan',input:'multi',choices:[]},
    {key:'kodeArsip',label:'KKA (Kode Klasifikasi Arsip)',input:'kodearsip',placeholder:'Ketik nama perkara, contoh: buku tamu'},
    {key:'tipeSurat',label:'Tipe Surat',input:'select',choices:[]},
    // R5G12: pilihannya ditarik dari master data, bukan daftar tetap di sini.
    // Yang TERSIMPAN adalah kodenya (ND), karena kode itulah yang tercetak di
    // nomor surat; namanya hanya untuk dibaca manusia saat memilih.
    {key:'jenisSurat',label:'Jenis Surat',input:'jenissurat'},
    // R5G13: nomor surat tidak lagi diketik. Ia dirakit backend saat draf
    // dibuat dan hanya ditampilkan di sini.
    {key:'nomorSurat',label:'Nomor Surat',input:'nomorsurat'},
    {key:'tujuan',label:'Kepada',placeholder:'Nama tujuan surat'},
    {key:'perihal',label:'Perihal Resmi (jika berbeda)',placeholder:'Opsional, isi bila berbeda dari Hal / Tentang'},
    // Dua nilai yang sama dengan derajat surat MASUK (migrasi 034).
    {key:'sifatSurat',label:'Derajat Surat',input:'select',choices:['Biasa','Kilat']},
    // R5G13: akhiran nomor surat. Dipilih petugas, bukan ditebak dari isian
    // "Kepada" yang berupa teks bebas.
    {key:'unitNomor',label:'Lingkup Surat',input:'select',choices:['Bagrenmin','Urmin','Subbagren','Subbagsumda','Subbagbinfung']},
  ]},
  // R5G4: jenisAgenda, hasil, dan statusAgenda tidak lagi ditampilkan, dan
  // Kode Agenda tidak lagi diketik manual. Ketiga kunci lama TETAP diterima
  // backend — lihat catatan di urmin_register.go — sehingga agenda yang sudah
  // ada tidak gagal disunting hanya karena form berhenti menampilkannya.
  //
  // `peserta` digantikan `yangMenghadiri`, tapi kuncinya TETAP diterima backend
  // supaya agenda lama yang sudah punya isian peserta tidak gagal disunting.
  agenda: {title:'Agenda & Rapat',singular:'Agenda',code:'Kode Agenda',name:'Nama Agenda / Rapat',icon:'agenda',helper:'Register kegiatan, rapat, undangan, notulen, dan tindak lanjut.',fields:[
    {key:'tanggal',label:'Tanggal',input:'date'},
    {key:'waktu',label:'Jam',placeholder:'Contoh: 09:30'},
    {key:'lokasi',label:'Lokasi',placeholder:'Ruangan atau tempat'},
    {key:'pimpinan',label:'Pimpinan',placeholder:'Nama pimpinan rapat'},
    {key:'penyelenggara',label:'Penyelenggara / PIC',placeholder:'Nama koordinator'},
    {key:'yangMenghadiri',label:'Yang Menghadiri',input:'multi',choices:JABATAN_HADIR},
  ]},
  arsip: {title:'Arsip & Dokumentasi',singular:'Arsip',code:'Kode Arsip Internal',name:'Judul / Nama Arsip',icon:'arsip',helper:'Register metadata arsip dan lampiran PDF/foto; tanpa mengubah aturan retensi atau pemusnahan arsip resmi.',fields:[
    {key:'jenisArsip',label:'Jenis Arsip',input:'select',choices:['Surat Masuk','Surat Keluar','Administrasi','Rapat','Laporan','Lainnya']},
    {key:'tanggalDokumen',label:'Tanggal Dokumen',input:'date'},
    {key:'lokasiSimpan',label:'Lokasi Penyimpanan',placeholder:'Contoh: Rak A / Folder Internal'},
    {key:'retensi',label:'Informasi Retensi (catatan)',placeholder:'Mengacu pada jadwal retensi yang berlaku'},
    {key:'penanggungJawab',label:'Penanggung Jawab',placeholder:'Nama PIC'},
    {key:'statusArsip',label:'Status',input:'select',choices:['Aktif','Inaktif','Tinjau Retensi']},
    {key:'keterangan',label:'Keterangan',input:'textarea'},
  ]},
}

const url = '/api/v1/urmin/registry/'
const workURL = '/api/v1/unit-work/urmin/records/'
const MAX_FILE_SIZE = 5 * 1024 * 1024
const ACCEPTED = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
const validFileName = (name: string) => /\.(pdf|jpe?g|png)$/i.test(name)
function errorMessage(raw: string) { return ({
  access_denied: 'Akun belum memiliki akses aktif ke data ini. Periksa grant Urmin.',
  duplicate_code: 'Kode sudah digunakan untuk kategori data ini.',
  stale_version: 'Data telah berubah di sesi lain. Muat ulang data lalu coba lagi.',
  active_disposition: 'Masih ada disposisi aktif. Selesaikan tugas tersebut sebelum mengarsipkan.',
  outgoing_locked: 'Surat sudah diajukan. Jika memerlukan perubahan, Kabagrenmin harus mengembalikan surat untuk revisi.',
  pdf_required_before_submit: 'Lampirkan minimal satu PDF surat sebelum diajukan.',
  recipient_required: 'Isi tujuan/penerima surat sebelum diajukan.',
  // Empat syarat penyusun nomor surat (R5G13). Tanpa terjemahan, kodenya
  // tampil mentah di layar, mis. "derajat_required".
  derajat_required: 'Pilih Derajat surat; dibutuhkan untuk menyusun nomor surat.',
  jenis_surat_required: 'Pilih Jenis Surat; dibutuhkan untuk menyusun nomor surat.',
  kode_arsip_required: 'Pilih KKA (Kode Klasifikasi Arsip); dibutuhkan untuk menyusun nomor surat.',
  unit_nomor_required: 'Pilih Lingkup Surat; dibutuhkan untuk menyusun nomor surat.',
  workflow_state_changed: 'Status surat berubah. Muat ulang dan coba lagi.',
  invalid_urminregister_record: 'Periksa kode, nama, tanggal, jumlah, dan panjang isian.',
  not_found: 'Data tidak ditemukan atau sudah diarsipkan.',
  file_limit_5mib: 'Maksimal 5 MiB untuk setiap foto atau PDF.',
  unsupported_file_type: 'Hanya file PDF, JPG, JPEG, atau PNG yang didukung.',
  max_10_files: 'Maksimal 10 lampiran aktif per surat.'
} as Record<string, string>)[raw] || raw }
async function call<T>(endpoint: string, method = 'GET', payload?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if(method !== 'GET') {
    const csrf = await fetch('/api/v1/auth/csrf', {credentials:'same-origin',cache:'no-store'})
    if(!csrf.ok) throw Error('Sesi/CSRF tidak tersedia. Silakan login kembali.')
    const token: {csrfToken:string} = await csrf.json()
    headers['X-CSRF-Token'] = token.csrfToken
    headers['Content-Type'] = 'application/json'
  }
  const r = await fetch(endpoint, {method,credentials:'same-origin',cache:'no-store',headers,...(payload === undefined ? {} : {body:JSON.stringify(payload)})})
  if(!r.ok) {
    const e: {error?:string} = await r.json().catch(() => ({}))
    throw Error(errorMessage(e.error || `Permintaan gagal (HTTP ${r.status})`))
  }
  return r.json() as Promise<T>
}
// R5H5: purpose 'pendukung' = berkas pendukung surat keluar (migrasi 044),
// tidak terkunci alur persetujuan. Tanpa purpose = lampiran surat, seperti dulu.
async function uploadAttachment(recordID: string, file: File, purpose?: 'pendukung'): Promise<void> {
  const csrf = await fetch('/api/v1/auth/csrf', { credentials:'same-origin', cache:'no-store' })
  if(!csrf.ok) throw Error('Sesi/CSRF tidak tersedia. Silakan login kembali.')
  const token: {csrfToken:string} = await csrf.json()
  const body = new FormData()
  body.append('file',file)
  if(purpose) body.append('purpose',purpose)
  const r = await fetch(`${workURL}${encodeURIComponent(recordID)}/files`,{
    method:'POST', credentials:'same-origin', cache:'no-store',
    headers:{'X-CSRF-Token':token.csrfToken}, body
  })
  if(!r.ok) {
    const e:{error?:string} = await r.json().catch(()=>({}))
    throw Error(errorMessage(e.error || `Upload gagal (HTTP ${r.status})`))
  }
}
/**
 * R5G4: Kode Agenda tidak lagi diketik manual.
 *
 * Kolomnya TIDAK bisa dihapus — `sdl_urmin_registry.ref_code` NOT NULL, dan
 * `urminregisterValid` menuntut 2..64 karakter di kedua backend. Yang bisa
 * dilakukan adalah berhenti meminta pengguna mengisinya dan membangkitkannya
 * sendiri. Detik ikut dipakai karena `UNIQUE(kind, lower(ref_code))` menolak
 * duplikat; dua agenda yang dibuat pada detik yang sama akan ditolak dengan
 * `duplicate_code`, dan itu jauh lebih jarang daripada dua orang mengarang
 * kode yang sama.
 */
function agendaCode(now = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `AGD-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
    + `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

/**
 * Kode Register Internal surat keluar, dibangkitkan dengan cara yang sama
 * seperti agendaCode (keputusan pemilik sistem 2026-11-04: tidak diisi manual).
 * Backend tetap mewajibkan `code` 2-64 karakter dan unik per kind; empat hex
 * acak membuat dua draf pada detik yang sama praktis tidak pernah bertabrakan.
 * Ini BUKAN nomor surat — nomor surat dibangkitkan backend saat draf disimpan
 * dari satu deret per tahun yang dipakai bersama seluruh subbag.
 */
function suratKeluarCode(now = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(2)), b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `SK-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
    + `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${rnd}`
}

/**
 * Kode Register yang DITAMPILKAN untuk surat keluar adalah nomor urut pada
 * nomor surat (B/ND-157/X/HUM.1.2./2026/Bagrenmin -> "157"), keputusan pemilik
 * sistem 2026-11-04. Nomor itu baru ada setelah backend menyimpan draf, jadi
 * ref_code yang tersimpan tetap kunci teknis dari suratKeluarCode(): angka urut
 * berulang tiap tahun dan ref_code wajib unik per kind, sementara kontrak API
 * beku selama migrasi. Surat lama tanpa nomor surat menampilkan kodenya sendiri.
 */
function nomorUrut(nomorSurat?: string): string {
  const m = (nomorSurat || '').match(/-(\d+)\/(?:XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\//)
  return m ? m[1] : ''
}

/**
 * Pemilih jabatan ganda. Disimpan sebagai satu string dipisah koma, bukan
 * array, karena `fields` di backend bertipe map[string]string dengan batas 200
 * karakter per nilai. Kelima jabatan yang ada berjumlah ~57 karakter kalau
 * dipilih semua, jadi batas itu tidak pernah tersentuh.
 *
 * Urutannya mengikuti JABATAN_HADIR, bukan urutan klik, supaya dua agenda
 * dengan kehadiran sama menghasilkan string yang sama persis.
 */
function MultiPick({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const picked = value.split(',').map(s=>s.trim()).filter(Boolean)
  const toggle = (choice: string) => {
    const next = picked.includes(choice) ? picked.filter(x=>x!==choice) : [...picked, choice]
    onChange((field.choices||[]).filter(c=>next.includes(c)).join(', '))
  }
  return <div className="sumda-field sumda-field-wide">
    <span>{field.label}</span>
    <div className="sdl-multipick" role="group" aria-label={field.label}>
      {(field.choices||[]).map(choice=>{
        const on = picked.includes(choice)
        return <button type="button" key={choice} className={`sdl-multipick__chip${on?' is-on':''}`} aria-pressed={on} onClick={()=>toggle(choice)}>
          <Icon name={on?'check':'plus'} size={15}/> {choice}
        </button>
      })}
    </div>
    <small className="sdl-multipick__hint">{picked.length===0?'Belum ada yang dipilih. Boleh lebih dari satu.':`${picked.length} dipilih: ${picked.join(', ')}`}</small>
  </div>
}

/**
 * R5G10: pemilih kode arsip untuk nomor surat.
 *
 * Arahnya NAMA -> KODE. Petugas mengetik "buku tamu", daftar menampilkan
 * HUM.1.2. beserta namanya, dan yang tersimpan adalah kodenya.
 *
 * Pencarian dikirim ke server, bukan disaring di sini: 701 baris tidak pantas
 * diunduh tiap kali form dibuka, dan pencarian ILIKE di Postgres atas tabel
 * sekecil itu lebih murah daripada memindahkan seluruh isinya ke peramban.
 */
function KodeArsipPick({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<KodeArsip[]>([])
  const [state, setState] = useState<'idle'|'loading'|'error'>('idle')
  const [open, setOpen] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const needle = term.trim()
    if (!open || needle.length < 2) { setHits([]); setState('idle'); return }
    const mine = ++seq.current
    // Ditunda 250 ms supaya tiap ketukan tidak menjadi satu permintaan.
    const timer = setTimeout(() => {
      setState('loading')
      call<{items:KodeArsip[];limited:boolean}>(`/api/v1/urmin/kode-arsip/?q=${encodeURIComponent(needle)}`)
        .then(d => { if (seq.current === mine) { setHits(d.items); setState('idle') } })
        .catch(() => { if (seq.current === mine) { setHits([]); setState('error') } })
    }, 250)
    return () => clearTimeout(timer)
  }, [term, open])

  return <label className="sumda-field sumda-field-wide">
    <span>{field.label}</span>
    {value
      ? <div className="sdl-kodearsip__picked">
          <strong>{value}</strong>
          <button type="button" className="sumda-button sumda-button-quiet" onClick={()=>{onChange('');setOpen(true);setTerm('')}}>Ganti</button>
        </div>
      : <>
          <input value={term} onFocus={()=>setOpen(true)} onChange={e=>{setTerm(e.target.value);setOpen(true)}} placeholder={field.placeholder||''} maxLength={100}/>
          {open && term.trim().length >= 2 && <div className="sdl-kodearsip__hits">
            {state === 'loading' ? <small>Mencari...</small>
              : state === 'error' ? <small>Daftar kode belum bisa dimuat.</small>
              : hits.length === 0 ? <small>Tidak ada kode yang cocok.</small>
              : hits.slice(0, 12).map(h => <button type="button" key={h.code} onClick={()=>{onChange(h.code);setOpen(false)}}>
                  <strong>{h.code}</strong><span>{h.name}</span>
                </button>)}
          </div>}
          <small className="sdl-kodearsip__hint">Ketik minimal 2 huruf nama perkaranya. Kode inilah yang masuk ke nomor surat.</small>
        </>}
  </label>
}

/**
 * R5G12: dropdown jenis surat dari master data.
 *
 * Daftarnya pendek dan dimuat seluruhnya — berbeda dari kode arsip yang 701
 * baris dan karena itu perlu pencarian. Nilai lama yang sudah tidak ada di
 * master tetap ditampilkan sebagai pilihan bertanda, supaya menyunting surat
 * lama tidak diam-diam mengosongkan jenisnya.
 */
function JenisSuratPick({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const [items, setItems] = useState<{code:string;name:string}[]>([])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    call<{items:{code:string;name:string}[]}>('/api/v1/urmin/jenis-surat/')
      .then(d => { if (live) setItems(d.items) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [])
  const known = items.some(i => i.code === value)
  return <label className="sumda-field"><span>{field.label}</span>
    <select value={value} onChange={e=>onChange(e.target.value)}>
      <option value="">Pilih jenis surat</option>
      {items.map(i => <option key={i.code} value={i.code}>{i.code} — {i.name}</option>)}
      {value && !known && <option value={value}>{value} (nilai lama)</option>}
    </select>
    <small className="sdl-kodearsip__hint">{failed
      ? 'Daftar jenis surat belum bisa dimuat.'
      : items.length === 0
        ? 'Belum ada jenis surat. Superadmin dapat menambahkannya di Master Data.'
        : 'Kode inilah yang masuk ke nomor surat.'}</small>
  </label>
}

const blank = (kind: Kind): Draft => ({kind,code:kind==='agenda'?agendaCode():kind==='surat_keluar'?suratKeluarCode():'',title:'',classification:'biasa',fields:kind==='surat_keluar'?{statusAdministrasi:'Draft'}:{},version:0})
const readableDate = (iso: string) => {const date = new Date(iso);return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0,2).map(x => x.charAt(0).toLocaleUpperCase('id-ID')).join('') || '–'

// R5H3: pilihan dropdown Surat Keluar yang hidup di luar kode.
//
// Enam daftar referensi dari master data (/urmin/surat-opsi). Dua daftar
// rujukan dari data nyata yang memang boleh dilihat akun ini -- penyaringannya
// sudah terjadi di backend (surat masuk lewat Engine A, arahan hanya milik
// penerima/penerbitnya), layar tidak menyaring ulang.
//
// Yang tersimpan adalah teks pilihannya (<=200 karakter). Kegagalan memuat satu
// daftar tidak menggagalkan form: daftar itu tampil kosong, dan nilai yang sudah
// tersimpan tetap tampil sebagai "(nilai lama)".
type OpsiRow = {code:string;name:string}
type SuratOpsi = Record<'jalurSurat'|'penandatangan'|'pemberiNomor'|'verifikator'|'tembusan'|'tipeSurat', OpsiRow[]>
const clip = (s:string) => [...s].slice(0,200).join('')
// Rujukan Surat mengikuti Rujukan Arahan. Arahan sudah menyimpan surat asalnya
// (incomingId, migrasi 035), jadi memilih keduanya terpisah hanya membuka
// peluang data yang saling bertentangan. Nilai yang tersimpan tetap teks label
// seperti sebelumnya; kontrak API tidak berubah.
const SURAT_TAK_TAMPIL = 'Surat asal arahan (tidak dapat ditampilkan untuk akun ini)'
type SuratKeluarChoices = { choices: Record<string,string[]>; suratOfArahan: Record<string,string>; arahanIdOf: Record<string,string> }
function useSuratKeluarChoices(active:boolean): SuratKeluarChoices {
  const [choices,setChoices] = useState<SuratKeluarChoices>({choices:{},suratOfArahan:{},arahanIdOf:{}})
  useEffect(()=>{
    if(!active) return
    let alive = true
    void (async()=>{
      const [opsi,surat,inbox,sent] = await Promise.allSettled([
        call<SuratOpsi>('/api/v1/urmin/surat-opsi/'),
        call<{items:{id:string;agendaNo:number;letterNumber:string;subject:string}[]}>('/api/v1/urmin/surat-masuk/?q='),
        call<{items:{id:string;title:string;issuerName:string;createdAt:string;incomingId?:string}[]}>('/api/v1/leadership/directives/inbox'),
        call<{items:{id:string;title:string;issuerName:string;createdAt:string;incomingId?:string}[]}>('/api/v1/leadership/directives/sent'),
      ])
      const next: Record<string,string[]> = {}
      if(opsi.status==='fulfilled') for(const [k,rows] of Object.entries(opsi.value)) next[k] = rows.map(r=>r.name)
      const suratLabel = new Map<string,string>()
      if(surat.status==='fulfilled') for(const l of surat.value.items) suratLabel.set(l.id, clip(`#${l.agendaNo} · ${l.letterNumber} — ${l.subject}`))
      if(surat.status==='fulfilled') next.rujukanSurat = [...suratLabel.values()]
      // /sent hanya untuk Kabagrenmin; 403 bagi akun lain dan itu wajar.
      const seen = new Set<string>()
      const arahan = [...(inbox.status==='fulfilled'?inbox.value.items:[]),...(sent.status==='fulfilled'?sent.value.items:[])]
        .filter(d=>!seen.has(d.id)&&seen.add(d.id))
        .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
      const suratOfArahan: Record<string,string> = {}
      // R5H5: label → ID arahan. ID-nya ikut disimpan (rujukanArahanId) supaya
      // lembar arahan dapat menampilkan nomor surat keluar ini sebagai No.
      // Agenda; label saja tidak bisa dicocokkan backend dengan andal.
      const arahanIdOf: Record<string,string> = {}
      next.rujukanArahan = arahan.map(d=>{
        const label = clip(`${d.title} — ${d.issuerName}, ${new Date(d.createdAt).toLocaleDateString('id-ID',{dateStyle:'medium',timeZone:'Asia/Jakarta'})}`)
        // Surat asal ada tetapi di luar jangkauan baca akun ini (mis. bukan
        // petugas Urmin): tetap dikunci, dengan keterangan, bukan dibiarkan
        // kosong diam-diam atau diisi surat lain.
        if(d.incomingId) suratOfArahan[label] = suratLabel.get(d.incomingId) ?? SURAT_TAK_TAMPIL
        if(!arahanIdOf[label]) arahanIdOf[label] = d.id
        return label
      })
      if(alive) setChoices({choices:next,suratOfArahan,arahanIdOf})
    })()
    return ()=>{alive=false}
  },[active])
  return choices
}

/**
 * R5H5: panel berkas surat keluar. Dipakai di jendela "Berkas" (dibuka dari
 * daftar) dan di jendela "Proses" (detail surat keluar).
 *
 * Berkas disimpan ke catatan Berkas Kerja milik surat itu (endpoint unit-work
 * yang sama dengan form Edit), jadi otomatis tampil juga di menu Berkas Kerja.
 *
 * Yang dikelola di sini hanya BERKAS PENDUKUNG (purpose 'pendukung', migrasi
 * 044): bisa ditambah dan dihapus kapan saja, termasuk setelah surat diajukan
 * atau disetujui, karena tidak ikut sidik jari persetujuan. Lampiran surat
 * (form Edit) sengaja tidak ditampilkan di sini.
 */
function BerkasSuratKeluar({workRecordId,onPreview}:{workRecordId:string;onPreview:(file:StoredFile)=>void}) {
  const [files,setFiles]=useState<StoredFile[]|null>(null)
  const [busy,setBusy]=useState(false)
  const [progress,setProgress]=useState('')
  const [issue,setIssue]=useState('')
  const alive=useRef(true)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  const refresh=useCallback(async()=>{
    const result=await call<{files:StoredFile[]}>(`${workURL}${encodeURIComponent(workRecordId)}`)
    if(alive.current) setFiles(result.files.filter(f=>f.purpose==='pendukung'))
  },[workRecordId])
  useEffect(()=>{
    setFiles(null);setIssue('')
    refresh().catch(e=>{if(alive.current){setFiles([]);setIssue(e instanceof Error?e.message:'Berkas tidak bisa dimuat')}})
  },[refresh])
  async function add(list:FileList|null) {
    if(!list||busy)return
    setIssue('')
    const room=10-(files?.length??0)
    const problems:string[]=[]
    const ok=Array.from(list).filter(f=>{
      if(!validFileName(f.name)||!['application/pdf','image/jpeg','image/png',''].includes(f.type)){problems.push(`Format tidak didukung: ${f.name}.`);return false}
      if(f.size===0||f.size>MAX_FILE_SIZE){problems.push(`${f.name}: ukuran harus 1 byte–5 MiB.`);return false}
      return true
    })
    if(ok.length>room){problems.push(`Maksimal 10 berkas per surat; ${ok.length-room} berkas tidak diunggah.`);ok.splice(room)}
    setBusy(true)
    let done=0
    try {
      for(const f of ok){
        setProgress(`Mengunggah ${done+1} dari ${ok.length}: ${f.name}`)
        try{await uploadAttachment(workRecordId,f,'pendukung');done++}
        catch(e){problems.push(`${f.name}: ${e instanceof Error?e.message:'gagal diunggah'}.`)}
      }
      await refresh()
      if(done) showToast(`${done} berkas ditambahkan dan tersimpan di Berkas Kerja.`,'success')
    } catch(e){problems.push(e instanceof Error?e.message:'Berkas tidak bisa dimuat ulang')}
    finally{if(alive.current){setBusy(false);setProgress('');setIssue(problems.join(' '))}}
  }
  async function remove(file:StoredFile) {
    if(busy)return
    if(!await confirmDialog(`Hapus berkas ${file.name}?`,{confirmLabel:'Hapus',danger:true}))return
    setBusy(true);setIssue('')
    try{await call(`${workURL}${encodeURIComponent(workRecordId)}/files/${encodeURIComponent(file.id)}`,'DELETE',{});await refresh();showToast('Berkas dihapus.','success')}
    catch(e){if(alive.current)setIssue(e instanceof Error?e.message:'Gagal menghapus berkas')}
    finally{if(alive.current)setBusy(false)}
  }
  return <div className="urmin-berkas-panel">
    <label className="urmin-upload-zone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void add(e.dataTransfer.files)}}>
      <Icon name="upload" size={24}/><strong>{busy?'Mengunggah…':'Tambah berkas PDF atau foto'}</strong><span>Seret file ke sini atau klik · PDF, JPG, PNG · maks. 5 MiB · 10 berkas per surat</span>
      <input type="file" multiple accept={ACCEPTED} disabled={busy||(files?.length??0)>=10} onChange={e=>{void add(e.target.files);e.currentTarget.value=''}} aria-label="Pilih berkas surat keluar"/>
    </label>
    {progress&&<p className="urmin-file-progress" role="status">{progress}</p>}
    {issue&&<p className="urmin-upload-error" role="alert">{issue}</p>}
    {files===null?<p className="urmin-file-hint">Memuat berkas…</p>
      :files.length===0?<p className="urmin-file-hint">Belum ada berkas pendukung.</p>
      :<div className="urmin-file-section"><strong>Berkas pendukung ({files.length})</strong><div className="urmin-file-grid">{files.map(file=><div className="urmin-file-card" key={file.id}>
        <div className="urmin-file-thumb"><Icon name={file.mediaType==='application/pdf'?'file':'image'} size={26}/><span>{file.mediaType==='application/pdf'?'PDF':'FOTO'}</span></div>
        <div className="urmin-file-name" title={file.name}>{file.name}</div><small>{(file.size/1024).toFixed(0)} KB</small>
        <div className="urmin-file-actions"><button type="button" disabled={busy} onClick={()=>onPreview(file)}><Icon name="eye" size={15}/> Lihat</button><a href={`${workURL}${encodeURIComponent(workRecordId)}/files/${encodeURIComponent(file.id)}`} download={file.name}>Unduh</a><button type="button" disabled={busy} onClick={()=>void remove(file)}>Hapus</button></div>
      </div>)}</div></div>}
  </div>
}

/**
 * R5H5: berkas sebuah ARSIP DISPOSISI, ditarik dari sumber aslinya — tidak
 * disalin ke Berkas Kerja arsip. Alasannya: lampiran surat masuk boleh 10 MB
 * sedangkan Berkas Kerja 5 MB, dan salinan akan melepaskan berkas dari
 * pemeriksaan akses sumbernya (surat Rahasia tetap Rahasia). Entri arsip
 * disposisi sudah menyimpan incomingId dan dispositionId sejak R5G8.
 *
 *   Lampiran surat masuk  GET /urmin/surat-masuk/{incomingId}/attachments
 *   Bukti tindak lanjut   GET /urmin/dispositions/{dispositionId}/attachments
 *   Lampiran arahan       arahan (inbox + sent) yang incomingId-nya sama,
 *                         lalu GET /leadership/directives/{id}/attachments
 *
 * Tiap kelompok dimuat terpisah; kelompok yang ditolak server tampil sebagai
 * "tidak dapat diakses", bukan menggagalkan seluruh panel.
 */
type LinkedFile = { key: string; name: string; mime: string; size: number; url: string }
type LinkedGroup = { title: string; state: 'loading'|'ready'|'denied'; files: LinkedFile[] }
async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, {credentials:'same-origin', cache:'no-store'})
  if(!r.ok) throw Error(String(r.status))
  return r.json() as Promise<T>
}
function BerkasArsipDisposisi({incomingId,dispositionId,onPreview}:{incomingId:string;dispositionId:string;onPreview:(file:LinkedFile)=>void}) {
  const [groups,setGroups]=useState<LinkedGroup[]>([
    {title:'Lampiran Surat Masuk',state:'loading',files:[]},
    {title:'Bukti Tindak Lanjut',state:'loading',files:[]},
    {title:'Lampiran Arahan',state:'loading',files:[]},
  ])
  useEffect(()=>{
    let alive=true
    const set=(i:number,g:Omit<LinkedGroup,'title'>)=>{if(alive)setGroups(prev=>prev.map((x,j)=>j===i?{...x,...g}:x))}
    const letter=`/api/v1/urmin/surat-masuk/${encodeURIComponent(incomingId)}`
    if(incomingId) getJSON<{items:{id:string;filename:string;mime:string;size:number}[]}>(`${letter}/attachments`)
      .then(d=>set(0,{state:'ready',files:(d.items||[]).map(f=>({key:`sm-${f.id}`,name:f.filename,mime:f.mime,size:f.size,url:`${letter}/attachments/${encodeURIComponent(f.id)}/download`}))}))
      .catch(()=>set(0,{state:'denied',files:[]}))
    else set(0,{state:'ready',files:[]})
    const task=`/api/v1/urmin/dispositions/${encodeURIComponent(dispositionId)}`
    if(dispositionId) getJSON<{items:{id:string;filename:string;mimeType:string;sizeBytes:number}[]}>(`${task}/attachments`)
      .then(d=>set(1,{state:'ready',files:(d.items||[]).map(f=>({key:`bt-${f.id}`,name:f.filename,mime:f.mimeType,size:f.sizeBytes,url:`${task}/attachments/${encodeURIComponent(f.id)}/download`}))}))
      .catch(()=>set(1,{state:'denied',files:[]}))
    else set(1,{state:'ready',files:[]})
    void (async()=>{
      if(!incomingId){set(2,{state:'ready',files:[]});return}
      const base='/api/v1/leadership/directives'
      // /sent hanya untuk Kabagrenmin; 403 bagi akun lain dan itu wajar.
      const lists=await Promise.allSettled([getJSON<{items:{id:string;incomingId?:string}[]}>(`${base}/inbox`),getJSON<{items:{id:string;incomingId?:string}[]}>(`${base}/sent`)])
      const ids=[...new Set(lists.flatMap(r=>r.status==='fulfilled'?(r.value.items||[]):[]).filter(d=>d.incomingId===incomingId).map(d=>d.id))]
      const files=await Promise.allSettled(ids.map(id=>getJSON<{items:{id:string;name:string;mime:string;size:number}[]}>(`${base}/${encodeURIComponent(id)}/attachments`)))
      set(2,{state:'ready',files:files.flatMap(r=>r.status==='fulfilled'?(r.value.items||[]):[]).map(f=>({key:`ar-${f.id}`,name:f.name,mime:f.mime,size:f.size,url:`${base}/attachments/${encodeURIComponent(f.id)}/download`}))})
    })().catch(()=>set(2,{state:'denied',files:[]}))
    return()=>{alive=false}
  },[incomingId,dispositionId])
  return <div className="urmin-berkas-panel">{groups.map(g=><div className="urmin-file-section" key={g.title}>
    <strong>{g.title}{g.state==='ready'?` (${g.files.length})`:''}</strong>
    {g.state==='loading'?<p className="urmin-file-hint">Memuat…</p>
      :g.state==='denied'?<p className="urmin-file-hint">Tidak dapat diakses dengan hak akses akun ini.</p>
      :g.files.length===0?<p className="urmin-file-hint">Tidak ada berkas.</p>
      :<div className="urmin-file-grid">{g.files.map(file=><div className="urmin-file-card" key={file.key}>
        <div className="urmin-file-thumb"><Icon name={file.mime==='application/pdf'?'file':'image'} size={26}/><span>{file.mime==='application/pdf'?'PDF':'FOTO'}</span></div>
        <div className="urmin-file-name" title={file.name}>{file.name}</div><small>{(file.size/1024).toFixed(0)} KB</small>
        <div className="urmin-file-actions"><button type="button" onClick={()=>onPreview(file)}><Icon name="eye" size={15}/> Lihat</button><a href={file.url} download={file.name}>Unduh</a></div>
      </div>)}</div>}
  </div>)}</div>
}

export default function UrminR5D({kind,openFiles,initialID,initialCreate}: {kind:Kind;openFiles:(id:string)=>void;initialID?:string;initialCreate?:boolean}) {
  const def = schema[kind]
  const {choices:dynamicChoices,suratOfArahan,arahanIdOf} = useSuratKeluarChoices(kind==='surat_keluar')
  const formFields = useMemo(()=>def.fields.map(f=>dynamicChoices[f.key]?{...f,choices:dynamicChoices[f.key]}:f),[def,dynamicChoices])
  const [records,setRecords] = useState<Entry[]>([])
  const [selected,setSelected] = useState<Entry|null>(null)
  const [form,setForm] = useState<Draft>(() => blank(kind))
  // R5H6: surat keluar boleh tanpa rujukan (mis. undangan atas inisiatif
  // sendiri). Ini pilihan layar saja -- tidak ada kunci baru di backend: "tanpa
  // rujukan" berarti rujukanArahan/rujukanSurat/rujukanArahanId dikosongkan.
  const [tanpaRujukan,setTanpaRujukan] = useState(false)
  const [editing,setEditing] = useState(false)
  const [search,setSearch] = useState('')
  const [appliedSearch,setAppliedSearch] = useState('')
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [limited,setLimited] = useState(false)
  const [sort,setSort] = useState<'latest'|'az'>('latest')
  // R5G7: kategori arsip. '' = semua, 'manual' = diinput sendiri,
  // 'disposisi' = lahir dari pengarsipan disposisi (endpoint 143).
  const [source,setSource] = useState<''|'manual'|'disposisi'>('')
  const [outgoingFilter,setOutgoingFilter] = useState<OutgoingStatus>('all')
  const [workflowRecord,setWorkflowRecord]=useState<Entry|null>(null)
  // R5H5: jendela Berkas surat keluar yang dibuka dari daftar.
  const [berkasRecord,setBerkasRecord]=useState<Entry|null>(null)
  // R5H5: jendela berkas untuk arsip yang berasal dari disposisi.
  const [arsipRecord,setArsipRecord]=useState<Entry|null>(null)
  const [workflowDetail,setWorkflowDetail]=useState<WorkflowDetail|null>(null)
  const [workflowNote,setWorkflowNote]=useState('')
  const [workflowBusy,setWorkflowBusy]=useState(false)
  const [queued,setQueued] = useState<QueuedFile[]>([])
  const queuedRef = useRef<QueuedFile[]>([])
  const [savedFiles,setSavedFiles] = useState<StoredFile[]>([])
  const [filesLoading,setFilesLoading] = useState(false)
  const [preview,setPreview] = useState<FilePreview|null>(null)
  const previewRef = useRef<FilePreview|null>(null)
  const [progress,setProgress] = useState('')
  const [inlineError,setInlineError] = useState('')
  // The live refs also revoke Blob URLs on unmount; queued files never leave the browser
  // unless their upload is explicitly saved by the operator.
  useEffect(() => { queuedRef.current = queued },[queued])
  useEffect(() => { previewRef.current = preview },[preview])
  useEffect(() => () => {
    queuedRef.current.forEach(q=>URL.revokeObjectURL(q.url))
    if(previewRef.current?.temporary) URL.revokeObjectURL(previewRef.current.url)
  },[])


  async function load(q = '', src = source) {
    const data = await call<{items:Entry[];limited:boolean}>(`${url}?kind=${kind}&q=${encodeURIComponent(q)}${src?`&source=${src}`:''}`)
    setRecords(data.items)
    setLimited(data.limited)
    setAppliedSearch(q)
  }
  // R5G7: mengganti kategori memuat ulang dari server, bukan menyaring daftar
  // yang sudah ada. Backend memotong di 100 baris per kategori, jadi menyaring
  // di sini akan menampilkan potongan dari jendela yang salah.
  useEffect(() => {
    if(kind!=='arsip') return
    let alive = true
    setLoading(true)
    call<{items:Entry[];limited:boolean}>(`${url}?kind=${kind}&q=${encodeURIComponent(appliedSearch)}${source?`&source=${source}`:''}`)
      .then(data => { if(alive){setRecords(data.items);setLimited(data.limited)} })
      .catch(e => { if(alive) setError(e instanceof Error?e.message:'Gagal memuat data') })
      .finally(() => { if(alive) setLoading(false) })
    return () => { alive = false }
  // appliedSearch sengaja TIDAK ikut: pencarian punya jalurnya sendiri lewat
  // load(), dan menambahkannya di sini membuat tiap pencarian berjalan dua kali.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[source,kind])
  useEffect(() => {
    let alive = true
    setRecords([]); setSelected(null); setForm(blank(kind)); setEditing(false)
    setSearch(''); setAppliedSearch(''); setError(''); setNotice(''); setLimited(false); setLoading(true)
    setSource('')
    call<{items:Entry[];limited:boolean}>(`${url}?kind=${kind}`).then(data => {
      if(alive) {setRecords(data.items);setLimited(data.limited)}
    }).catch(e => {if(alive) setError(e instanceof Error?e.message:'Tidak bisa memuat data')}).finally(() => {if(alive) setLoading(false)})
    return () => {alive = false}
  }, [kind])
  useEffect(() => {
    if(!editing) return
    const close = (event: KeyboardEvent) => {if(event.key === 'Escape' && !busy && !preview) closeEditor()}
    window.addEventListener('keydown',close)
    return () => window.removeEventListener('keydown',close)
  }, [editing,busy,preview,queued])

  useEffect(()=>{if(notice)showToast(notice,'success')},[notice])
  useEffect(()=>{if(error)showToast(error,'error')},[error])
  const sorted = useMemo(() => [...records].sort((a,b) => sort==='az' ? a.title.localeCompare(b.title,'id') : new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()),[records,sort])
  const displayed = useMemo(() => kind!=='surat_keluar'||outgoingFilter==='all'?sorted:sorted.filter(item=>outgoingStatus(item)===outgoingFilter),[kind,outgoingFilter,sorted])
  // R5H5: paginasi seperti menu Disposisi. Kembali ke halaman 1 saat filter,
  // sumber, atau isi daftar berubah.
  const {pageItems:pagedRows,pager} = usePaged(displayed,[kind,outgoingFilter,source,records.length])
  const countStatus=(status:OutgoingStatus) => status==='all'?records.length:records.filter(item=>outgoingStatus(item)===status).length
  useEffect(()=>{if(initialID){const item=records.find(p=>p.id===initialID);if(item)setSelected(item)}},[initialID,records])
  useEffect(()=>{if(initialCreate){newRecord()}},[initialCreate])
  const flagged = records.filter(p => p.classification==='penting').length
  const detail = (p:Entry) => schema[kind].fields.slice(0,2).map(f=>p.fields[f.key]).filter(Boolean).join(' · ')

  function clearQueued() {
    queuedRef.current.forEach(q=>URL.revokeObjectURL(q.url))
    queuedRef.current=[]
    setQueued([])
  }
  function dismissPreview() {
    if(previewRef.current?.temporary) URL.revokeObjectURL(previewRef.current.url)
    previewRef.current=null
    setPreview(null)
  }
  async function closeEditor() {
    if(busy) return
    if(queuedRef.current.length && !await confirmDialog('Batalkan lampiran yang belum disimpan?',{confirmLabel:'Tutup Form',danger:true})) return
    dismissPreview();clearQueued();setSavedFiles([]);setEditing(false);setProgress('');setInlineError('')
  }
  async function refreshSavedFiles(workRecordID:string) {
    const result = await call<{files:StoredFile[]}>(`${workURL}${encodeURIComponent(workRecordID)}`)
    // R5H5: form Edit hanya mengelola lampiran surat; berkas pendukung ada di
    // jendela Berkas. Batas 10 di backend juga dihitung per jenis.
    setSavedFiles(result.files.filter(f=>f.purpose!=='pendukung'))
  }
  function newRecord() {
    dismissPreview();clearQueued();setSavedFiles([]);setSelected(null);setForm(blank(kind));setTanpaRujukan(false)
    setEditing(true);setError('');setNotice('');setInlineError('');setProgress('')
  }
  function edit(p:Entry) {
    if(kind==='surat_keluar' && !['draft','rejected'].includes(outgoingStatus(p))) {showToast('Surat yang diajukan tidak dapat diedit sampai dikembalikan untuk revisi.','error');return}
    dismissPreview();clearQueued();setSavedFiles([]);setSelected(p)
    setForm({kind,code:p.code,title:p.title,classification:p.classification,fields:{...p.fields},version:p.version})
    setTanpaRujukan(kind==='surat_keluar'&&!p.fields.rujukanArahan&&!p.fields.rujukanSurat)
    setEditing(true);setError('');setNotice('');setInlineError('');setProgress('')
    if(kind==='surat_keluar') {
      setFilesLoading(true)
      void refreshSavedFiles(p.workRecordId).catch(e=>setInlineError(e instanceof Error?e.message:'Lampiran tidak bisa dimuat')).finally(()=>setFilesLoading(false))
    }
  }
  function stageFiles(files:FileList|null) {
    if(!files) return
    setInlineError('')
    const accepted:QueuedFile[]=[]
    let issue=''
    const available = 10-savedFiles.length-queuedRef.current.length
    for(const file of Array.from(files)) {
      if(accepted.length>=available) {issue='Maksimal 10 lampiran aktif per surat.';break}
      if(!validFileName(file.name) || !['application/pdf','image/jpeg','image/png',''].includes(file.type)) {issue=`Format tidak didukung: ${file.name}`;continue}
      if(file.size===0 || file.size>MAX_FILE_SIZE) {issue=`${file.name}: ukuran harus 1 byte–5 MiB.`;continue}
      accepted.push({id:`${Date.now()}-${Math.random()}`,file,url:URL.createObjectURL(file)})
    }
    if(accepted.length) {
      queuedRef.current=[...queuedRef.current,...accepted]
      setQueued(queuedRef.current)
    }
    if(issue){setInlineError(issue);showToast(issue,'error')}
  }
  function unstage(id:string) {
    const item=queuedRef.current.find(q=>q.id===id)
    if(!item)return
    if(previewRef.current?.url===item.url) dismissPreview()
    URL.revokeObjectURL(item.url)
    queuedRef.current=queuedRef.current.filter(q=>q.id!==id)
    setQueued(queuedRef.current)
  }
  function showStaged(file:QueuedFile) {
    dismissPreview()
    setPreview({name:file.file.name,mime:file.file.type||(/\.pdf$/i.test(file.file.name)?'application/pdf':'image/jpeg'),url:file.url,temporary:false})
  }
  async function showSaved(file:StoredFile,recordID:string) {
    setInlineError('')
    try {
      const response=await fetch(`${workURL}${encodeURIComponent(recordID)}/files/${encodeURIComponent(file.id)}`,{credentials:'same-origin',cache:'no-store'})
      if(!response.ok) throw Error(`Gagal membuka lampiran (HTTP ${response.status})`)
      // Fetch into an authenticated Blob URL, so PDF can be embedded even though
      // the existing R5A download endpoint intentionally sends attachment headers.
      const blob=new Blob([await response.arrayBuffer()],{type:file.mediaType})
      const objectURL=URL.createObjectURL(blob)
      dismissPreview()
      setPreview({name:file.name,mime:file.mediaType,url:objectURL,temporary:true})
    } catch(e) {const msg=e instanceof Error?e.message:'Gagal membuka lampiran';setInlineError(msg);showToast(msg,'error')}
  }
  // R5H5: pratinjau berkas dari sumber lain (arsip disposisi), lewat Blob URL
  // yang sama seperti showSaved supaya PDF bisa ditanam.
  async function showLinked(file:LinkedFile) {
    try {
      const response=await fetch(file.url,{credentials:'same-origin',cache:'no-store'})
      if(!response.ok) throw Error(`Gagal membuka berkas (HTTP ${response.status})`)
      const blob=new Blob([await response.arrayBuffer()],{type:file.mime})
      dismissPreview()
      setPreview({name:file.name,mime:file.mime,url:URL.createObjectURL(blob),temporary:true})
    } catch(e) {showToast(e instanceof Error?e.message:'Gagal membuka berkas','error')}
  }
  async function deleteSaved(file:StoredFile,recordID:string) {
    if(!await confirmDialog(`Hapus lampiran ${file.name}?`,{confirmLabel:"Hapus",danger:true}))return
    if(busy)return
    setBusy(true);setInlineError('')
    try {
      await call(`${workURL}${encodeURIComponent(recordID)}/files/${encodeURIComponent(file.id)}`,'DELETE',{})
      await refreshSavedFiles(recordID)
      setNotice('Lampiran berhasil dihapus.')
    } catch(e) {const msg=e instanceof Error?e.message:'Gagal menghapus lampiran';setInlineError(msg);showToast(msg,'error')}
    finally {setBusy(false)}
  }
  async function run(action:()=>Promise<void>,message:string) {
    if(busy)return
    setBusy(true);setError('');setNotice('');setInlineError('')
    try {await action();setNotice(message)}
    catch(e) {const msg=e instanceof Error?e.message:'Gagal menghubungi API';setError(msg);setInlineError(msg)}
    finally {setProgress('');setBusy(false)}
  }
  function save(e:FormEvent<HTMLFormElement>) {
    e.preventDefault()
    void run(async()=>{
      let row:Entry
      if(kind==='surat_keluar')form.fields.statusAdministrasi='Draft'
      if(selected) {
        const changed = selected.code!==form.code || selected.title!==form.title || selected.classification!==form.classification || JSON.stringify(selected.fields)!==JSON.stringify(form.fields)
        if(changed) await call(`${url}${selected.id}`,'PATCH',form)
        row=changed?await call<Entry>(`${url}${selected.id}`):selected
      } else {
        const created=await call<{id:string;workRecordId:string}>(url,'POST',form)
        // Immediately remember the created record: failed uploads must NEVER create duplicates.
        row={id:created.id,workRecordId:created.workRecordId,kind,code:form.code,title:form.title,classification:form.classification,fields:{...form.fields},version:1,createdAt:new Date().toISOString()}
        setSelected(row)
        row=await call<Entry>(`${url}${created.id}`).catch(()=>row)
      }
      setSelected(row)
      setForm({kind,code:row.code,title:row.title,classification:row.classification,fields:{...row.fields},version:row.version})
      let uploaded=0
      const filesToUpload=[...queuedRef.current]
      for(const item of filesToUpload) {
        setProgress(`Mengunggah lampiran ${uploaded+1} dari ${filesToUpload.length}: ${item.file.name}`)
        try {await uploadAttachment(row.workRecordId,item.file)}
        catch(e) {
          await refreshSavedFiles(row.workRecordId).catch(()=>undefined)
          throw Error(`Data surat sudah tersimpan. ${uploaded} lampiran berhasil diunggah; ${item.file.name} gagal: ${e instanceof Error?e.message:'Upload gagal'}. Klik Simpan lagi untuk mengulang lampiran yang tersisa.`)
        }
        uploaded++
        unstage(item.id)
      }
      await refreshSavedFiles(row.workRecordId).catch(()=>undefined)
      await load(appliedSearch)
      setEditing(false);setSelected(null)
    },'Surat dan lampiran berhasil disimpan.')
  }
  async function openWorkflow(p:Entry) {
    setWorkflowRecord(p);setWorkflowDetail(null);setWorkflowNote('');setWorkflowBusy(true)
    try {
      const item=await call<WorkflowDetail>(`${url}${encodeURIComponent(p.id)}/workflow`)
      setWorkflowDetail(item)
    } catch(e) {showToast(e instanceof Error?e.message:'Gagal memuat alur persetujuan','error');setWorkflowRecord(null)}
    finally {setWorkflowBusy(false)}
  }
  async function workflowAction(action:'submit'|'approve'|'reject') {
    if(!workflowRecord||!workflowDetail||workflowBusy)return
    if(action==='reject'&&workflowNote.trim().length<8){showToast('Alasan pengembalian minimal 8 karakter.','error');return}
    const message=action==='submit'?'Ajukan surat ini kepada Kabagrenmin? Setelah diajukan, berkas tidak dapat diubah.':action==='approve'?'Setujui pengajuan surat ini? Persetujuan bukan tanda tangan elektronik.':'Kembalikan surat ini untuk diperbaiki?'
    if(!await confirmDialog(message,{confirmLabel:action==='submit'?'Ajukan':action==='approve'?'Setujui':'Kembalikan',danger:action==='reject'}))return
    setWorkflowBusy(true)
    try {
      await call(`${url}${encodeURIComponent(workflowRecord.id)}/${action}`,'POST',{version:workflowDetail.version,note:workflowNote.trim()})
      const updated=await call<WorkflowDetail>(`${url}${encodeURIComponent(workflowRecord.id)}/workflow`)
      setWorkflowDetail(updated);setWorkflowNote('')
      await load(appliedSearch)
      showToast(action==='submit'?'Surat diajukan ke Kabagrenmin.':action==='approve'?'Surat disetujui; menunggu proses tanda tangan elektronik.':'Surat dikembalikan untuk revisi.','success')
    }catch(e){showToast(e instanceof Error?e.message:'Proses surat gagal','error')}
    finally {setWorkflowBusy(false)}
  }
  async function remove(p:Entry) {
    if(kind==='surat_keluar' && !['draft','rejected'].includes(outgoingStatus(p))){showToast('Surat yang sudah diajukan tidak bisa diarsipkan dari daftar ini.','error');return}
    if(!await confirmDialog(`Arsipkan ${p.title}? Riwayat tetap tersimpan.`,{confirmLabel:"Arsipkan",danger:true})) return
    void run(async () => {
      await call(`${url}${p.id}`,'DELETE',{})
      setSelected(null);setEditing(false)
      await load(appliedSearch)
    }, 'Data berhasil diarsipkan.')
  }
  function searchRecords(e:FormEvent<HTMLFormElement>) {e.preventDefault();void run(() => load(search.trim()),'')}
  function resetSearch() {setSearch('');void run(()=>load(''),'')}
  function changeField(key:string,value:string) {
    setForm(v=>{
      const fields = {...v.fields,[key]:value}
      // Arahan yang berasal dari surat menentukan Rujukan Surat. Arahan tanpa
      // surat asal (umum/sprint/lainnya) membiarkan pilihan manual apa adanya.
      if(kind==='surat_keluar'&&key==='rujukanArahan'&&suratOfArahan[value]) fields.rujukanSurat = suratOfArahan[value]
      // Selalu ditimpa (termasuk dikosongkan) supaya ID tidak tertinggal saat
      // rujukan arahan diganti atau dihapus.
      if(kind==='surat_keluar'&&key==='rujukanArahan') fields.rujukanArahanId = arahanIdOf[value] ?? ''
      return {...v,fields}
    })
  }
  const rujukanSuratLocked = kind==='surat_keluar' && Boolean(suratOfArahan[form.fields.rujukanArahan||''])
  function chooseRujukan(tanpa:boolean) {
    setTanpaRujukan(tanpa)
    if(tanpa) setForm(v=>({...v,fields:{...v.fields,rujukanArahan:'',rujukanSurat:'',rujukanArahanId:''}}))
  }
  const RUJUKAN_KEYS = ['rujukanArahan','rujukanSurat']

  return <div className="sumda-r5b urmin-r5d">
    {kind!=='surat_keluar'&&<section className="sumda-overview" aria-label="Ringkasan data">
      <div className="sumda-overview-mark"><Icon name={def.icon} size={24}/></div>
      <div className="sumda-overview-title"><span className="sumda-eyebrow">REGISTER / URMIN</span><h2>{def.title}</h2></div>
      <div className="sumda-overview-stats">
        <div className="sumda-stat"><span>Data ditampilkan</span><strong>{loading?'–':records.length}</strong></div>
        <div className="sumda-stat"><span>Klasifikasi penting</span><strong>{loading?'–':flagged}</strong></div>
      </div>
    </section>}

    <section className="sumda-card sumda-register" aria-label={`Daftar ${def.singular}`}>
      <div className="sumda-card-head">
        <div>{kind!=='surat_keluar'&&<span className="sumda-eyebrow">PERSURATAN & ADMINISTRASI UMUM</span>}<h3>{kind==='surat_keluar'?'Daftar Surat Keluar':`Daftar ${def.singular}`}</h3></div>
        <button className="sumda-button sumda-button-primary" type="button" onClick={newRecord}><Icon name="plus" size={18}/> Tambah {def.singular}</button>
      </div>
      <div className="sumda-toolbar">
        <form className="sumda-search" onSubmit={searchRecords} role="search">
          <Icon name="search" size={18}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} maxLength={100} aria-label={`Cari ${def.singular}`} placeholder={`Cari ${def.code.toLowerCase()}, nama...`}/>
          <button type="submit" disabled={busy}>{busy?'Memuat...':'Cari'}</button>
        </form>
        <div className="sumda-toolbar-controls">
          {kind==='arsip'&&<>
            <label className="sumda-sort-label" htmlFor="urmin-arsip-source">Kategori</label>
            <select id="urmin-arsip-source" value={source} onChange={e=>setSource(e.target.value as ''|'manual'|'disposisi')} aria-label="Kategori arsip">
              <option value="">Semua Arsip</option>
              <option value="manual">Input Manual</option>
              <option value="disposisi">Dari Disposisi</option>
            </select>
          </>}
          <label className="sumda-sort-label" htmlFor={`urmin-sort-${kind}`}>Urutkan</label>
          <select id={`urmin-sort-${kind}`} value={sort} onChange={e=>setSort(e.target.value as 'latest'|'az')} aria-label="Urutan daftar"><option value="latest">Terbaru</option><option value="az">Nama A–Z</option></select>
          <button className="sumda-icon-button" type="button" onClick={()=>{void run(()=>load(appliedSearch),'')}} disabled={busy} title="Muat ulang" aria-label="Muat ulang"><Icon name="refresh" size={18}/></button>
          {(appliedSearch||search)&&<button className="sumda-button sumda-button-quiet" type="button" onClick={resetSearch} disabled={busy}>Reset</button>}
        </div>
      </div>
      {kind==='surat_keluar'&&<div className="sdl-outgoing-tabs" role="group" aria-label="Filter status surat keluar">{outgoingTabs.filter(tab=>tab.id!=='legacy'||records.some(item=>outgoingStatus(item)==='legacy')).map(tab=><button type="button" key={tab.id} className={outgoingFilter===tab.id?'is-active':''} aria-pressed={outgoingFilter===tab.id} onClick={()=>setOutgoingFilter(tab.id)}>{tab.label}<span>{loading?'–':countStatus(tab.id)}</span></button>)}</div>}
      
      {limited&&<div className="sumda-inline-note"><Icon name="info" size={16}/> Data yang dimuat dibatasi 100 entri; filter status hanya berlaku pada data yang ditampilkan. Gunakan pencarian untuk menemukan surat lain.</div>}
      {loading ? <div className="sumda-empty" role="status"><div className="sumda-empty-icon"><Icon name="refresh" size={24}/></div><h4>Memuat data...</h4><p></p></div>
      : displayed.length===0 ? <div className="sumda-empty"><div className="sumda-empty-icon"><Icon name={appliedSearch?'search':def.icon} size={30}/></div><h4>{kind==='surat_keluar'&&outgoingFilter!=='all'?'Tidak ada surat pada status ini':appliedSearch?'Tidak ada hasil yang cocok':'Belum ada data terdaftar'}</h4><p>{kind==='surat_keluar'&&outgoingFilter!=='all'?'Ubah filter status atau cari menggunakan kode register.':appliedSearch?'Coba kata kunci lain atau reset pencarian.':'Belum ada data. Tambahkan data pertama Anda.'}</p><button type="button" className="sumda-button sumda-button-primary" onClick={kind==='surat_keluar'&&outgoingFilter!=='all'?()=>setOutgoingFilter('all'):appliedSearch?resetSearch:newRecord}>{kind==='surat_keluar'&&outgoingFilter!=='all'?'Semua status':appliedSearch?'Tampilkan semua':`Tambah ${def.singular} pertama`}</button></div>
      : <div className="sumda-table-scroll"><table className="sumda-table"><thead>{kind==='surat_keluar'?<tr><th>Register / Nomor Surat</th><th>Perihal</th><th>Kepada</th><th>Tanggal Surat</th><th>Status Surat</th><th className="sumda-actions-title">Aksi</th></tr>:<tr>{kind!=='agenda'&&<th>{def.code}</th>}<th>Judul / Keterangan</th><th>Informasi</th>{kind!=='agenda'&&<th>Klasifikasi</th>}<th>Tanggal input</th><th className="sumda-actions-title">Aksi</th></tr>}</thead><tbody>{pagedRows.map(p=><tr key={p.id} className={selected?.id===p.id?'sdl-urmin-focus-row':undefined}>
         {kind==='surat_keluar'?<>
           <td><div className="sdl-outgoing-nomor"><span className="sumda-code">{nomorUrut(p.fields.nomorSurat)||p.code}</span><small className="sdl-outgoing-secondary">{p.fields.nomorSurat||'Nomor surat belum diisi'}</small></div></td>
           <td><strong className="sdl-outgoing-title">{p.title}</strong>{p.classification==='penting'&&<small className="sdl-outgoing-important">Penting</small>}</td>
           <td>{p.fields.tujuan||'–'}</td>
           <td className="sumda-secondary-cell">{p.fields.tanggalSurat?readableDate(`${p.fields.tanggalSurat}T12:00:00`):'–'}</td>
           <td><div className="sm-status"><span className={`sm-badge tone-${workflowTone[outgoingStatus(p)]||'neutral'}`} title={workflowLabel[outgoingStatus(p)]||'Draft'}>{workflowListLabel[outgoingStatus(p)]||'Draft'}</span></div></td>
         </>:<>
           {kind!=='agenda'&&<td><span className="sumda-code">{p.code}</span></td>}
           <td><div className="sumda-person-cell"><span className="sumda-avatar" aria-hidden="true">{initials(p.title)}</span><div><strong>{p.title}</strong>
             {/* R5G7: penanda tetap muncul walau sedang menampilkan "Semua
                 Arsip", supaya asal entri terbaca tanpa mengganti kategori. */}
             {kind==='arsip'&&<small className={`sdl-arsip-source${p.fields.sumber==='disposisi'?' is-disposisi':''}`}>{p.fields.sumber==='disposisi'?'Dari Disposisi':'Input Manual'}</small>}
           </div></div></td>
           <td className="sumda-secondary-cell">{detail(p)||'–'}</td>
           {kind!=='agenda'&&<td><span className={`sumda-classification ${p.classification==='penting'?'is-important':''}`}>{p.classification==='penting'?'Penting':'Biasa'}</span></td>}
           <td className="sumda-secondary-cell">{readableDate(p.createdAt)}</td>
         </>}
         <td><div className="sumda-actions">{kind==='surat_keluar'&&<button type="button" className="sumda-action" onClick={()=>void openWorkflow(p)}><Icon name="info" size={16}/> Proses</button>}<button type="button" className="sumda-action" title="Edit data" onClick={()=>edit(p)} disabled={kind==='surat_keluar'&&!(['draft','rejected'].includes(outgoingStatus(p)))}><Icon name="edit" size={16}/> <span>Edit</span></button><button type="button" className="sumda-action sumda-action-attachment" title={kind==='surat_keluar'?'Lihat dan tambah berkas surat':'Buka lampiran dan disposisi'} onClick={()=>kind==='surat_keluar'?setBerkasRecord(p):kind==='arsip'&&p.fields.sumber==='disposisi'?setArsipRecord(p):openFiles(p.workRecordId)}><Icon name="attachment" size={16}/> <span>{kind==='surat_keluar'?'Berkas':'File & Disposisi'}</span></button><button type="button" className="sumda-action sumda-action-danger" title="Arsipkan data" onClick={()=>remove(p)} disabled={busy||(kind==='surat_keluar'&&!(['draft','rejected'].includes(outgoingStatus(p))))}><Icon name="archive" size={16}/><span className="sumda-sr-only">Arsipkan</span></button></div></td>
        </tr>)}</tbody></table></div>}
      <Pager pager={pager} label={def.singular.toLowerCase()}/>
      <footer className="sumda-list-footer"><span><Icon name="list" size={15}/> {loading?'Memuat...':`${displayed.length} dari ${records.length} data ditampilkan${limited?' (hasil terbatas)':''}`}</span><span></span></footer>
    </section>



    

    {arsipRecord&&<div className="sumda-dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setArsipRecord(null)}}>
      <section className="sumda-dialog sdl-outgoing-workflow-modal" role="dialog" aria-modal="true" aria-labelledby="urmin-arsip-berkas-title">
        <div className="sumda-dialog-head"><div className="sumda-dialog-emblem"><Icon name="archive" size={22}/></div><div><span className="sumda-eyebrow">BERKAS ARSIP DISPOSISI</span><h2 id="urmin-arsip-berkas-title">{arsipRecord.title}</h2><p>{arsipRecord.fields.letterNumber||arsipRecord.code}</p></div><button type="button" className="sumda-dialog-close" onClick={()=>setArsipRecord(null)} aria-label="Tutup"><Icon name="close" size={20}/></button></div>
        <div className="sdl-outgoing-workflow-content">
          <BerkasArsipDisposisi incomingId={arsipRecord.fields.incomingId||''} dispositionId={arsipRecord.fields.dispositionId||''} onPreview={f=>void showLinked(f)}/>
          <div className="urmin-berkas-foot"><span>Berkas ditampilkan dari sumber aslinya, dengan hak akses masing-masing.</span><button type="button" className="sumda-button" onClick={()=>{const id=arsipRecord.workRecordId;setArsipRecord(null);openFiles(id)}}>Buka Berkas Kerja Arsip</button></div>
        </div>
      </section>
    </div>}
    {berkasRecord&&<div className="sumda-dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setBerkasRecord(null)}}>
      <section className="sumda-dialog sdl-outgoing-workflow-modal" role="dialog" aria-modal="true" aria-labelledby="urmin-berkas-title">
        <div className="sumda-dialog-head"><div className="sumda-dialog-emblem"><Icon name="attachment" size={22}/></div><div><span className="sumda-eyebrow">BERKAS SURAT KELUAR</span><h2 id="urmin-berkas-title">{berkasRecord.title}</h2><p>{berkasRecord.fields.nomorSurat||berkasRecord.code}</p></div><button type="button" className="sumda-dialog-close" onClick={()=>setBerkasRecord(null)} aria-label="Tutup"><Icon name="close" size={20}/></button></div>
        <div className="sdl-outgoing-workflow-content">
          <BerkasSuratKeluar workRecordId={berkasRecord.workRecordId} onPreview={f=>void showSaved(f,berkasRecord.workRecordId)}/>
          <div className="urmin-berkas-foot"><span>Berkas pendukung tersimpan otomatis di Berkas Kerja surat ini dan tidak memengaruhi persetujuan surat.</span><button type="button" className="sumda-button" onClick={()=>{const id=berkasRecord.workRecordId;setBerkasRecord(null);openFiles(id)}}>Buka di Berkas Kerja</button></div>
        </div>
      </section>
    </div>}
    {workflowRecord&&<div className="sumda-dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!workflowBusy)setWorkflowRecord(null)}}>
      <section className="sumda-dialog sdl-outgoing-workflow-modal" role="dialog" aria-modal="true" aria-labelledby="sdl-outgoing-workflow-title">
        <div className="sumda-dialog-head"><div className="sumda-dialog-emblem"><Icon name="surat_keluar" size={22}/></div><div><span className="sumda-eyebrow">ALUR SURAT KELUAR</span><h2 id="sdl-outgoing-workflow-title">{workflowRecord.title}</h2><p>{workflowRecord.code}</p></div><button type="button" className="sumda-dialog-close" disabled={workflowBusy} onClick={()=>setWorkflowRecord(null)} aria-label="Tutup"><Icon name="close" size={20}/></button></div>
        <div className="sdl-outgoing-workflow-content">
          {workflowDetail?<>
            <div className="sdl-outgoing-workflow-status"><strong>{workflowLabel[workflowDetail.status]||workflowDetail.status}</strong><span>{workflowDetail.status==='approved'?'Menunggu integrasi tanda tangan elektronik tersertifikasi. Surat belum dapat dikirim.':workflowDetail.status==='submitted'?'Menunggu keputusan Kabagrenmin.':workflowDetail.status==='rejected'?'Perbaiki surat dan lampiran, lalu ajukan kembali.':workflowDetail.status==='legacy'?'Status lama memerlukan verifikasi sebelum masuk alur resmi baru.':'Lampirkan PDF dan ajukan untuk persetujuan.'}</span></div>
            {(workflowDetail.canSubmit||workflowDetail.canReview)&&<label className="sumda-field"><span>{workflowDetail.canReview?'Catatan keputusan':'Catatan pengajuan (opsional)'}</span><textarea rows={3} maxLength={500} value={workflowNote} onChange={e=>setWorkflowNote(e.target.value)} placeholder={workflowDetail.canReview?'Isi arahan atau alasan jika dikembalikan...':'Catatan untuk Kabagrenmin...'}/></label>}
            <div className="sdl-outgoing-workflow-actions">
              {workflowDetail.canSubmit&&<button type="button" disabled={workflowBusy} className="sumda-button sumda-button-primary" onClick={()=>void workflowAction('submit')}>Ajukan ke Kabagrenmin</button>}
              {workflowDetail.canReview&&<><button type="button" disabled={workflowBusy} className="sumda-button sumda-button-primary" onClick={()=>void workflowAction('approve')}>Setujui Surat</button><button type="button" disabled={workflowBusy} className="sumda-button sumda-button-cancel" onClick={()=>void workflowAction('reject')}>Kembalikan untuk Revisi</button></>}
            </div>
            <h3 className="sdl-outgoing-workflow-subtitle">Berkas Pendukung</h3>
            <BerkasSuratKeluar workRecordId={workflowRecord.workRecordId} onPreview={f=>void showSaved(f,workflowRecord.workRecordId)}/>
            <h3 className="sdl-outgoing-workflow-subtitle">Riwayat Persetujuan</h3>
            {workflowDetail.events.length===0?<p className="sdl-outgoing-workflow-empty">Belum ada proses persetujuan.</p>:<div className="sdl-outgoing-workflow-timeline">{workflowDetail.events.map(ev=><div key={ev.id}><strong>{ev.action==='submitted'?'Diajukan':ev.action==='approved'?'Disetujui':'Dikembalikan'}</strong><small>{ev.actor} · {readableDate(ev.at)}</small>{ev.note&&<p>{ev.note}</p>}</div>)}</div>}
          </>:<p className="sdl-outgoing-workflow-empty">Memuat riwayat...</p>}
        </div>
      </section>
    </div>}
    {editing&&<div className="sumda-dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)closeEditor()}}>
      <section className="sumda-dialog" role="dialog" aria-modal="true" aria-labelledby="urmin-dialog-title" aria-describedby="urmin-dialog-hint">
        <div className="sumda-dialog-head"><div className="sumda-dialog-emblem"><Icon name={def.icon} size={22}/></div><div><span className="sumda-eyebrow">{selected?'UBAH DATA':'ENTRI BARU'} / URMIN</span><h2 id="urmin-dialog-title">{selected?'Edit':'Tambah'} {def.singular}</h2><p id="urmin-dialog-hint">{kind==='surat_keluar'?'Lengkapi data dan lampiran PDF, lalu ajukan melalui tombol Proses setelah tersimpan.':'Isi data di bawah ini. Kolom dengan tanda * wajib diisi.'}</p></div><button type="button" className="sumda-dialog-close" onClick={closeEditor} aria-label="Tutup formulir" disabled={busy}><Icon name="close" size={20}/></button></div>
        <form id="urmin-register-edit-form" className="sumda-dialog-form" onSubmit={save}>
          <div className="sumda-form-block"><div className="sumda-form-section"><span className="sumda-form-step">01</span><div><h3>Informasi utama</h3><p>Identitas dan nama {def.singular.toLowerCase()}.</p></div></div><div className="sumda-form-grid">
            {/* R5G4: agenda tidak lagi meminta kode. Nilainya tetap terkirim —
                backend mewajibkannya — hanya dibangkitkan, bukan diketik. */}
            {kind==='surat_keluar'&&<label className="sumda-field"><span>{def.code}</span><output className="sdl-nomorsurat">{nomorUrut(form.fields.nomorSurat)||(selected?form.code:'Terbit otomatis setelah disimpan')}</output><small className="sdl-kodearsip__hint">Sama dengan nomor urut pada Nomor Surat, diambil dari satu deret untuk seluruh subbag. Tidak perlu diisi.</small></label>}
            {kind!=='agenda'&&kind!=='surat_keluar'&&<label className="sumda-field"><span>{def.code} <b aria-label="wajib diisi">*</b></span><input autoFocus required minLength={2} maxLength={64} value={form.code} onChange={e=>setForm(v=>({...v,code:e.target.value}))} placeholder={`Masukkan ${def.code.toLowerCase()}`}/></label>}
            <label className="sumda-field"><span>{def.name} <b aria-label="wajib diisi">*</b></span><input required minLength={3} maxLength={200} value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))} placeholder={`Masukkan ${def.name.toLowerCase()}`}/></label>
          </div></div>
          <div className="sumda-form-block"><div className="sumda-form-section"><span className="sumda-form-step">02</span><div><h3>Detail {def.singular}</h3><p>Lengkapi informasi pendukung yang relevan.</p></div></div><div className="sumda-form-grid">
            {kind==='surat_keluar'&&<div className="sumda-field sumda-field-wide"><span id="urmin-dasar-surat">Dasar Surat</span>
              <div className="urmin-dasar" role="radiogroup" aria-labelledby="urmin-dasar-surat">
                {([[false,'Berdasarkan rujukan','Menjawab disposisi atau surat masuk'],[true,'Tanpa rujukan','Mis. undangan atas inisiatif sendiri']] as const).map(([tanpa,judul,ket])=>
                  <button type="button" key={judul} role="radio" aria-checked={tanpaRujukan===tanpa} className={`urmin-dasar__opt${tanpaRujukan===tanpa?' is-on':''}`} onClick={()=>chooseRujukan(tanpa)}>
                    <span className="urmin-dasar__dot" aria-hidden="true"/><span className="urmin-dasar__text"><strong>{judul}</strong><small>{ket}</small></span>
                  </button>)}
              </div>
            </div>}
            {formFields.filter(f=>!(kind==='surat_keluar'&&tanpaRujukan&&RUJUKAN_KEYS.includes(f.key))).map(f=>f.input==='multi'?<MultiPick key={f.key} field={f} value={form.fields[f.key]||''} onChange={v=>changeField(f.key,v)}/>:f.input==='kodearsip'?<KodeArsipPick key={f.key} field={f} value={form.fields[f.key]||''} onChange={v=>changeField(f.key,v)}/>:f.input==='jenissurat'?<JenisSuratPick key={f.key} field={f} value={form.fields[f.key]||''} onChange={v=>changeField(f.key,v)}/>:f.input==='nomorsurat'?<label className="sumda-field" key={f.key}><span>{f.label}</span>
              {/* R5G13: dibangkitkan backend saat draf dibuat, jadi ia
                  ditampilkan, bukan diminta. Dibiarkan sebagai teks statis dan
                  bukan input terkunci supaya tidak terlihat seperti kolom yang
                  seharusnya bisa diisi. */}
              <output className="sdl-nomorsurat">{form.fields[f.key]||'Terbit otomatis setelah disimpan'}</output>
              <small className="sdl-kodearsip__hint">Disusun dari Derajat, Jenis Surat, Kode Arsip, dan Lingkup Surat di bawah. Nomor urut diambil saat draf disimpan dan tidak dapat dipakai ulang.</small>
            </label>:f.key==='rujukanSurat'&&rujukanSuratLocked?<label className="sumda-field" key={f.key}><span>{f.label}</span>
              <output className="sdl-nomorsurat">{form.fields.rujukanSurat||suratOfArahan[form.fields.rujukanArahan||'']}</output>
              <small className="sdl-kodearsip__hint">Mengikuti surat asal dari Rujukan Disposisi. Kosongkan Rujukan Disposisi untuk memilih surat lain.</small>
            </label>:<label className={`sumda-field ${f.input==='textarea'?'sumda-field-wide':''}`} key={f.key}><span>{f.label}</span>{f.input==='select'?<select value={form.fields[f.key]||''} onChange={e=>changeField(f.key,e.target.value)}><option value="">Pilih {f.label.toLowerCase()}</option>{f.choices?.map(x=><option key={x} value={x}>{x}</option>)}{/* R5G11: nilai tersimpan yang sudah tidak ada di daftar tetap ditampilkan sebagai pilihan. Tanpa ini, mempersempit pilihan Derajat membuat surat lama tampil kosong di layar padahal datanya masih ada — lalu tersimpan kosong begitu disunting karena alasan lain. */}{form.fields[f.key]&&!f.choices?.includes(form.fields[f.key])&&<option value={form.fields[f.key]}>{form.fields[f.key]} (nilai lama)</option>}</select>:f.input==='textarea'?<textarea rows={3} maxLength={200} value={form.fields[f.key]||''} onChange={e=>changeField(f.key,e.target.value)} placeholder={f.placeholder||'Tambahkan keterangan...'}/>:<input type={f.input||'text'} min={f.input==='number'?0:undefined} step={f.input==='number'?1:undefined} maxLength={f.input==='number'?undefined:200} value={form.fields[f.key]||''} onChange={e=>changeField(f.key,e.target.value)} placeholder={f.placeholder||''}/>}</label>)}
          </div></div>
          {/* R5G4: agenda tidak memakai klasifikasi; seluruh agenda tercatat
              'biasa'. Blok ini disembunyikan, bukan dihapus — dua kind lain
              masih memakainya, dan backend tetap mewajibkan nilainya. */}
          {kind!=='agenda'&&<div className="sumda-form-block"><div className="sumda-form-section"><span className="sumda-form-step">03</span><div><h3>Pengaturan akses data</h3><p>Pilih klasifikasi sesuai dokumen yang dicatat.</p></div></div><div className="sumda-form-grid"><label className="sumda-field"><span>Klasifikasi</span><select value={form.classification} onChange={e=>setForm(v=>({...v,classification:e.target.value as 'biasa'|'penting'}))}><option value="biasa">Biasa</option><option value="penting">Penting</option></select></label><div className="sumda-classification-help"><Icon name="info" size={18}/><span>Data penting hanya dapat diakses oleh akun dengan grant klasifikasi yang sesuai.</span></div></div></div>}


          {kind==='surat_keluar'&&<div className="sumda-form-block urmin-attachment-block">
            <div className="sumda-form-section"><span className="sumda-form-step">04</span><div><h3>File Surat & Lampiran</h3><p>Upload PDF atau foto langsung saat membuat surat. Maksimal 5 MiB per file dan 10 lampiran aktif.</p></div></div>
            <label className="urmin-upload-zone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)stageFiles(e.dataTransfer.files)}}><Icon name="upload" size={24}/><strong>Pilih file PDF atau gambar</strong><span>PDF · JPG · JPEG · PNG · bisa pilih beberapa file sekaligus</span>
              <input type="file" multiple accept={ACCEPTED} disabled={busy||queued.length+savedFiles.length>=10} onChange={e=>{stageFiles(e.target.files);e.currentTarget.value=''}} aria-label="Pilih file surat dan lampiran" />
            </label>
            {filesLoading&&<p className="urmin-file-hint">Memuat lampiran tersimpan...</p>}
            {savedFiles.length>0&&<div className="urmin-file-section"><strong>Lampiran tersimpan ({savedFiles.length})</strong>
              <div className="urmin-file-grid">{savedFiles.map(file=><div className="urmin-file-card" key={file.id}>
                <div className="urmin-file-thumb"><Icon name={file.mediaType==='application/pdf'?'file':'image'} size={26}/><span>{file.mediaType==='application/pdf'?'PDF':'FOTO'}</span></div>
                <div className="urmin-file-name" title={file.name}>{file.name}</div><small>{(file.size/1024).toFixed(0)} KB</small>
                <div className="urmin-file-actions"><button type="button" disabled={busy} onClick={()=>void showSaved(file,selected?.workRecordId||'')}><Icon name="eye" size={15}/> Preview</button><a href={`${workURL}${encodeURIComponent(selected?.workRecordId||'')}/files/${encodeURIComponent(file.id)}`} download={file.name}>Unduh</a><button type="button" disabled={busy} aria-label={`Hapus ${file.name}`} onClick={()=>void deleteSaved(file,selected?.workRecordId||'')}><Icon name="trash" size={15}/></button></div>
              </div>)}</div>
            </div>}
            {queued.length>0&&<div className="urmin-file-section"><strong>Siap diunggah saat Simpan ({queued.length})</strong>
              <div className="urmin-file-grid">{queued.map(item=><div className="urmin-file-card" key={item.id}>
                <div className="urmin-file-thumb">{item.file.type.startsWith('image/')?<img src={item.url} alt={`Pratinjau ${item.file.name}`}/>:<><Icon name="file" size={26}/><span>PDF</span></>}</div>
                <div className="urmin-file-name" title={item.file.name}>{item.file.name}</div><small>{(item.file.size/1024).toFixed(0)} KB · belum disimpan</small>
                <div className="urmin-file-actions"><button type="button" disabled={busy} onClick={()=>showStaged(item)}><Icon name="eye" size={15}/> Preview</button><button type="button" disabled={busy} onClick={()=>unstage(item.id)}><Icon name="trash" size={15}/> Hapus</button></div>
              </div>)}</div>
            </div>}
            {!queued.length&&!savedFiles.length&&<p className="urmin-file-hint">Belum ada lampiran. File dapat ditambahkan sekarang atau saat mengedit surat.</p>}
            {inlineError&&<p className="urmin-upload-error" role="alert">{inlineError}</p>}
            {progress&&<p className="urmin-file-progress" role="status">{progress}</p>}
          </div>}
        </form>
        <div className="sumda-dialog-foot"><span/><div className="sumda-dialog-buttons"><button type="button" className="sumda-button sumda-button-cancel" disabled={busy} onClick={closeEditor}>Batal</button><button type="submit" form="urmin-register-edit-form" className="sumda-button sumda-button-primary" disabled={busy}><Icon name="check" size={18}/>{busy?'Menyimpan...':selected?'Simpan Perubahan':kind==='surat_keluar'?'Simpan Surat & Lampiran':'Simpan Data'}</button></div></div>
      </section>
    </div>}
    {preview&&<div className="urmin-preview-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)dismissPreview()}}>
      <section className="urmin-preview-dialog" role="dialog" aria-modal="true" aria-label={`Preview ${preview.name}`}>
        <header><strong>{preview.name}</strong><button type="button" aria-label="Tutup preview" onClick={dismissPreview}><Icon name="close" size={20}/></button></header>
        {preview.mime==='application/pdf'?<iframe src={preview.url} title={`PDF ${preview.name}`}/>:<div className="urmin-preview-image"><img src={preview.url} alt={preview.name}/></div>}
      </section>
    </div>}
  </div>
}
