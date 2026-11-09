# Config Docker khusus proyek

Satu-satunya alasan direktori ini ada: membuat `docker` bisa menarik image
dari Git Bash di Windows.

## Masalahnya

Docker Desktop menulis `credsStore: "desktop"` ke `~/.docker/config.json`.
Dijalankan dari Git Bash (MSYS), `docker.exe` menerima `PATH` bergaya POSIX,
lalu mencoba menjalankan credential helper lewat path yang tidak bisa
dieksekusi Windows:

```
error getting credentials - err: fork/exec /usr/bin/docker-credential-desktop.exe:
exec format error
```

Gejalanya muncul saat `docker compose build` atau `pull`, **sekalipun seluruh
image yang ditarik publik** (postgres, golang, node, alpine, caddy) dan tidak
butuh kredensial apa pun.

## Solusinya

`config.json` di sini sama persis dengan punya pengguna, minus `credsStore`.
`scripts/local-setup.sh` mengarahkan `DOCKER_CONFIG` ke direktori ini **hanya
saat berjalan di MSYS/Cygwin**.

`config.json` ditulis ulang oleh `local-setup.sh` setiap kali jalan: ia menambahkan
`cliPluginsExtraDirs` yang menunjuk ke `~/.docker/cli-plugins` milik pengguna.
Tanpa itu, mengalihkan `DOCKER_CONFIG` ikut menghilangkan plugin `docker compose`
pada Docker Desktop yang terpasang per-user (`GAGAL: Docker Compose v2 dibutuhkan.`).

Config global pengguna tidak disentuh. Login registry yang sudah ada tetap
utuh, dan dari PowerShell atau CMD Docker tetap memakai credential helper
seperti biasa.

## Kalau nanti perlu registry privat

Config ini tidak menyimpan kredensial. Untuk menarik dari registry privat,
jalankan perintahnya dari PowerShell (yang memakai config global), atau
hapus baris `DOCKER_CONFIG` di `local-setup.sh` setelah masalah PATH di Git Bash
teratasi dengan cara lain.
