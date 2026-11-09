# R4A3A — Pagu Sah & Realisasi Internal (Controlled Ledger)

## Scope

- Adds migration `017_subbagren_budget_realization.sql` without touching migrations 001–016.
- An internally approved, submitted proposal may be associated with at most ONE budget authorization document and a pagu amount. An internal approval alone NEVER generates pagu.
- A distinct authorized checker must verify the pagu based on independent examination of official source documents. A document **reference** does not prove authenticity and attachments are NOT implemented in R4A3A.
- A realization requires the verified pagu, fiscal-year match, and mandatory evidence reference/description. It does not count toward financial reports while pending or rejected.
- Verification of a realization is independent of its creator; row-level parent-pagu locks serialize concurrent verifications and block overspend.
- Reviewed budget records are immutable via the application; changes require new approved business workflows in a subsequent release.
- The financial overview counts only verified pagu and verified realization, filtered per user grant and proposal permission. It is capped at 200 records, is flagged limited on truncation, and is NOT official LRA.
- Unit security: `subbagren.usulan.read` plus `subbagren.anggaran.read` plus action grant. Superadmin must remain denied by auth middleware. No role grants inserted by migration.

## New permissions (DEFAULT OFF)

`subbagren.anggaran.read`, `subbagren.anggaran.pagu.register`, `subbagren.anggaran.pagu.verify`, `subbagren.anggaran.realisasi.record`, `subbagren.anggaran.realisasi.verify`.

Use distinct maker and verifier identities with classification and unit grant appropriate to each proposal. A user who registers pagu cannot verify that pagu, and a user who records a realization cannot verify that realization.

## API

- GET `/api/v1/subbagren/budget/?year=2027` scoped pagu/realization overview and totals as integer strings.
- POST `/api/v1/subbagren/budget/pagu` register authorization reference and amount (pending).
- POST `/api/v1/subbagren/budget/pagu/{id}/review` verify/reject independently.
- POST `/api/v1/subbagren/budget/realisasi` record pending realization.
- POST `/api/v1/subbagren/budget/realisasi/{id}/review` verify/reject with row lock and remaining-pagu check.

All mutations require CSRF and current authenticated operational session; no privileged Superadmin access.

## Verification

After safe install run `./sdl-run.sh && bash ./scripts/security-test-r2d5.sh`; target 20/20 security PASS. R3E first-password changes and browser E2E remain pending. Never import real financial records into the test environment until source documents, RBAC roles, and evidentiary retention policy have been validated.

## Next R4A3B

Private file uploads (PDF/images), checksum verification, attachment authorization through object grants, virus-scan pipeline, controlled archival, period-based reconciliation/export with precise reviewed evidence, and auditable corrections/adjustments.
