# R3B — Secure Attachment and Addressed Distribution

## Scope
- Only registered Urmin incoming letters (`status=registered`). Existing R3A draft and register endpoints are unchanged.
- Attachment: PDF, PNG, JPG/JPEG; max 5 MiB each, max 10 per letter, private PostgreSQL bytea and SHA256. Filename ASCII allowlist. Append-only in R3B (no delete/overwrite).
- PDF accepted with basic structural checks and **forced download, not preview**. PDFs can still contain malicious content; antivirus/content disarm is **not implemented**. Do not use with untrusted operational PDFs until the malware-scanning gate is completed.
- Addressed distribution requires *unit and individual recipient*, no blanket unit access. Explicit receipt confirmation generates an immutable event. Inbox count is the number of pending items among the latest 100 (not a global notification total).
- Separate authorizations: Urmin sender can read/distribute via R3A `access.EvaluateForUser` for the DB-loaded letter; receiver requires grant+role permission `urmin.distribusi.receive` for its own unit and classification, plus an actual addressed distribution. No automatic access to the entire Urmin register. Superadmin is blocked both in router and receipt authorization.

## API routes
| Method | Path | Use |
| --- | --- | --- |
| GET/POST | `/api/v1/urmin/surat-masuk/{id}/attachments` | List/upload |
| GET | `/api/v1/urmin/surat-masuk/{id}/attachments/{attachmentId}/download` | Download forced attachment |
| GET | `/api/v1/urmin/surat-masuk/{id}/recipient-candidates?unit=...` | Eligible users only |
| GET/POST | `/api/v1/urmin/surat-masuk/{id}/distributions` | Sender's status history / new delivery |
| GET | `/api/v1/urmin/distribution-inbox/` | Inbound deliveries addressed to current user |
| POST | `/api/v1/urmin/distribution-inbox/{distributionId}/receive` | Single receipt; JSON `{ "reason": "..." }` |
| GET | `/api/v1/urmin/distribution-inbox/{distributionId}/events` | Delivery timeline |

All mutation routes require authenticated session, same-origin CSRF protection, record-level authorization and audit. Reason ≥8 characters is required for upload/send/receive. Repeated receipt returns 409. Attachment download response includes `Content-Disposition: attachment`, `Content-Security-Policy: sandbox`, `nosniff`, and `no-store`.

## Operational roles and grant setup
Use Role & Permission Management to toggle rights, then User Management to assign the role to a particular unit with a bounded scope/classification. **Migration 010 adds keys to the catalog; it grants no user new rights.** If the recipient dropdown is empty, confirm recipient account active, password rotation finished, unit membership present, role permission `urmin.distribusi.receive` on the same active grant, classification limit sufficient.

## Data and release safety
- Migration `010_urmin_attachments_distribution.sql` only creates tables, indexes and permission catalog entries. It has no DROP/TRUNCATE or modification of existing documents. Migration runner uses checksum ledger + transaction.
- Installer verifies exact baselines and payload, backs up replaced files, stops on changed project sources, never modifies `.env`, Docker volumes or database directly.
- Standard `./sdl-run.sh` builds and runs migration. Security suite `bash ./scripts/security-test-r2d5.sh` uses separate ephemeral PostgreSQL; it must pass before production rollout.
- R3B does **not** implement approval/disposition, SMTP notifications, web push or global dashboard metrics. Inbox provides in-app actionable notification by polling/reload, not real-time push.
