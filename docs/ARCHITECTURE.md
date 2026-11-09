# SIERA DELTA LIMA | Foundation R1

- Frontend: React + Vite + Tailwind, responsive dan light/dark.
- Backend: Go modular monolith, chi, pgx.
- DB: PostgreSQL 18.6 di Compose project `sdl-foundation-r1`, volume terisolasi `sdl_root_r1_pgdata`.
- Folder kerja: project root langsung; tidak ada nested `v2/` pada arsitektur baru.
- R1 hanya UI shell, status API, database readiness dan pengujian dasar. Belum authentication, OTP, RBAC, persuratan atau data nyata.
- Security: authentication, per-unit scoping, audit, CSRF, TLS deployment production akan disiapkan pada fase lanjut.
- Folder `v2/` sisa instalasi sebelumnya tidak disentuh installer R1 root. Jangan hapus sebelum pengecekan.
