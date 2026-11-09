# SIERA DELTA LIMA — Foundation R1 (Root Layout)

**One Workspace. Full Visibility.**  
*Integrated Digital Workspace for BagRenmin*

## Struktur

- `apps/backend/` — Go (chi + pgx)
- `apps/frontend/` — React + Vite + Tailwind
- `infra/compose.dev.yaml` — Docker Compose dev
- `scripts/` — internal dev scripts
- `sdl-run.sh` / `sdl-stop.sh` — entrypoint dari root
- `docs/` — arsitektur & keputusan
- `0.sekerips/` — installer/patch files

## Jalankan setelah instalasi

```bash
cd ~/Downloads/1.siera-delta-lima && bash ./sdl-run.sh
```

Docker Desktop harus aktif dan Internet tersedia pada bootstrap pertama (Go/npm deps & container images). Script membutuhkan Docker, bukan Node.js Homebrew lokal.

Frontend: `http://127.0.0.1:5174` — API tersedia melalui `/api/v1/system/status`.

Untuk menghentikan service: `bash ./sdl-stop.sh` dari root.

## Isolasi & keamanan

- Instalasi tidak memodifikasi folder `v2/` dari instalasi sebelumnya, file di root yang sudah ada, atau PostgreSQL di luar Compose.
- Database untuk foundation baru terisolasi di volume Docker sendiri.
- `.env` root dibuat acak (mode 600), tidak dimasukkan Git.
- Go test dan frontend typecheck/build dijalankan oleh Docker build.
- R1 khusus development lokal; belum ada fitur autentikasi, persuratan, migrasi database, atau HTTPS production.
- Logo resmi `ds.png` opsional pada `apps/frontend/public/ds.png`, fallback teks SDL tersedia.
- Jika ada file/folder yang bentrok dengan target, installer berhenti tanpa overwrite.
