import { useEffect, useState } from 'react'

/**
 * R5H8: pilihan dropdown umum dari Master Data (migrasi 047, Express saja).
 *
 * Formulir tetap menyimpan daftar bawaannya sendiri di kode. Daftar itu hanya
 * dipakai bila master tidak bisa dibaca -- backend Go (rollback Caddy) tidak
 * mengenal endpoint ini -- atau bila himpunannya dikosongkan Superadmin.
 */
export type OpsiUnit = 'urmin' | 'subbagsumda' | 'subbagbinfung'
type Opsi = Record<string, string[]>

/** `kind:fieldKey` di formulir -> set_key di Master Data. */
const FIELD_SET: Record<string, string> = {
  'arsip:jenisArsip': 'arsip-jenis',
  'arsip:statusArsip': 'arsip-status',
  'agenda:yangMenghadiri': 'agenda-hadir',
  'personel:status': 'personel-status',
  'inventaris:kondisi': 'kondisi-barang',
  'sop:jenis': 'sop-jenis',
  'sop:statusDokumen': 'sop-status',
  'pid:kategori': 'pid-kategori',
  'pid:tingkatAkses': 'pid-tingkat-akses',
  'pid:statusDokumen': 'pid-status',
  'rb:statusTindakLanjut': 'rb-status',
}

export function useOpsiDropdown(unit: OpsiUnit, active = true): Opsi {
  const [opsi, setOpsi] = useState<Opsi>({})
  useEffect(() => {
    if (!active) return
    let alive = true
    fetch(`/api/v1/${unit}/opsi-dropdown/`, { credentials: 'same-origin', cache: 'no-store' })
      .then(r => r.ok ? r.json() as Promise<Record<string, { code: string; name: string }[]>> : Promise.reject(new Error(String(r.status))))
      .then(data => {
        if (!alive) return
        setOpsi(Object.fromEntries(Object.entries(data).map(([k, rows]) => [k, rows.map(x => x.name)])))
      })
      .catch(() => { /* tetap pakai daftar bawaan formulir */ })
    return () => { alive = false }
  }, [unit, active])
  return opsi
}

/** Mengganti `choices` bawaan dengan isi Master Data, bila tersedia. */
export function withOpsi<F extends { key: string; choices?: string[] }>(fields: F[], kind: string, opsi: Opsi): F[] {
  return fields.map(f => {
    const set = FIELD_SET[`${kind}:${f.key}`]
    const list = set ? opsi[set] : undefined
    return list && list.length > 0 ? { ...f, choices: list } : f
  })
}
