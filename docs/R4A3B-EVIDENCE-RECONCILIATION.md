# R4A3B — Encrypted Evidence + Scoped Internal Reconciliation

## Scope

This patch adds migration `018_subbagren_evidence_reconciliation.sql` and keeps previous financial tables and verified transactions unchanged. It does **not** confer financial permissions to any existing role automatically.

A new realization can be independently verified ONLY after one immutable financial evidence file is **approved** by a separate person. Proof is not accepted based on an upload alone. Rejected proof remains in audit history and a replacement can be uploaded while the realization is pending. Finance reviewer still checks available authorized pagu under parent row lock.

Upload is a multipart `file` and `reason`, PDF/JPEG/PNG <= 5 MiB; filename restricted, MIME determined from bytes, image dimensions bounded and PDF envelope minimally inspected. The file is encrypted with **AES-256-GCM** under a dedicated `SDL_EVIDENCE_KEY` before writing PostgreSQL bytea, with plaintext SHA-256 recorded for integrity. Downloads are authenticated per transaction, use `attachment` / `application/octet-stream` / `nosniff` headers, and never provide public links. SHA/GCM tampering fails closed; no plaintext fallback.

**The encryption key is irreplaceable** without an explicit, audited re-encryption process. Back it up separately and securely with backup-restore tests, never place it in git, never rotate it casually. R4A3B installer creates key only when absent; it preserves a valid existing key and fails closed on malformed configurations. Source backup includes `.env` (sensitive); do not share backup files.

### New permissions (DEFAULT OFF)

- `subbagren.anggaran.bukti.upload` — authorized maker, active Subbagren grant
- `subbagren.anggaran.bukti.read` — list/download authorized transaction proof
- `subbagren.anggaran.bukti.verify` — independent checker approves/rejects proof
- `subbagren.anggaran.reconcile` — source-unit reconciliation within granted scope

Existing `subbagren.usulan.read`, `subbagren.anggaran.read`, and financial permissions still apply independently to every relevant record. Superadmin is never a financial operator.

### Endpoints

- `GET /api/v1/subbagren/budget/realisasi/{id}/evidence`
- `POST /api/v1/subbagren/budget/realisasi/{id}/evidence` (multipart)
- `GET /api/v1/subbagren/budget/realisasi/{id}/evidence/{proofId}/download`
- `POST /api/v1/subbagren/budget/realisasi/{id}/evidence/{proofId}/review` (JSON decision approved/rejected, version, reason)
- `GET /api/v1/subbagren/budget/reconciliation?year=2026`

Reconciliation combines authorized **verified** amounts with counts of pending/rejected transactions and proof completeness, grouped by *source unit string* registered in proposals. Truncation flags incomplete partial reporting. Source units are self-entered text, not validated organizational master-data identifiers. Not official LRA; it cannot replace reconciled treasury information or document provenance.

### Safety / production blockers

No malware/AV scanning, external source validation of DIPA/BKU/SP2D, digital signature verification, retention policy, automatic archival, pagu authorization file upload, or official reporting. PDF content should only be downloaded as attachments and checked in controlled workflows. Don't upload sensitive real financial documents before those gates and policy are approved.

### Mac verification

After extraction and checksum-safe installation, run `./sdl-run.sh && bash ./scripts/security-test-r2d5.sh`. Expected automated security suite **21/21** (20 previous + scenario `09i`), then separate manual functional browser E2E. Verify PostgreSQL migration 018 separately if migration runner output doesn't list versions. The R3E 5-account first-password activation and browser E2E are still pending.
