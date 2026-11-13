---
description: Redesign halaman/komponen berbasis standar (audit → usulan → setuju → bangun)
argument-hint: <nama halaman atau path komponen> [catatan tambahan]
---
Redesign: $ARGUMENTS

Gunakan subagent `ui-ux-designer` dan ikuti urutan ini:

1. **Audit singkat** halaman saat ini: 5–10 temuan terpenting dengan standar yang dilanggar.
2. **Usulan**:
   - tujuan halaman, pengguna utama, dan 3 tugas terpenting;
   - wireframe ASCII desktop dan ponsel;
   - perubahan hierarki, alur, dan teks, beserta alasannya (rujuk standar/temuan audit);
   - token yang dipakai, dan token baru bila perlu (light + dark, dengan rasio kontras).
3. **BERHENTI** dan tunggu persetujuan saya. Jangan membuat file sebelum saya setuju.
4. Setelah disetujui, bangun prototipe di `mockup/redesign/<nama-halaman>.html`:
   satu file HTML mandiri, tanpa CDN atau font remote, menyalin token `:root` dari
   `apps/frontend/src/style.css`, mendukung light/dark dan lebar 320px–1440px,
   dengan data contoh yang ditandai sebagai contoh, dan menampilkan keadaan memuat/kosong/error.
5. Laporkan checklist standar (lulus/tidak per butir) dan apa yang perlu dicek manual di browser.
6. Porting ke `apps/frontend/src/` hanya kalau saya minta, lewat alur /rencana → /implementasi.
