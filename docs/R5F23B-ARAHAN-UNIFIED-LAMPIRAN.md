# R5F23B – Arahan Pimpinan: unified inbox and attachments

- One unified tab named "Arahan", plus "+ Buat Arahan" for Kabagrenmin only. Existing read/acknowledged flow remains.
- Separate **priority badge** (Biasa/Penting/Kilat) from **delivery badge** (Dikirim/Dibaca/Diterima); names and timestamps appear on each recipient detail.
- Private JPG/JPEG/PNG/PDF uploads, **100 MiB per file**, maximum **5 per directive**; server validates extension and file signature, no public URLs.
- Uploads attach to the issuer's draft first. The existing revision-locked send transaction moves them to the final directive; removing draft removes pending attachments, never historical sent attachments.
- PostgreSQL BYTEA for persistence, currently unencrypted at application level. Account for growth in backups and storage, restrict access to backups/DB, and migrate to private encrypted object storage if volume grows.
- Supported image preview requires authentication; PDF uses secure download. The backend forces `Content-Disposition: attachment` and `nosniff`.
- **Testing gate**: run Go/React build locally and UAT Kabag→two recipients (read, acknowledge, download); verify non-recipient and superadmin cannot fetch file IDs.
