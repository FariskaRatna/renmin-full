# SIERA DELTA LIMA — R2C2B Delegasi Kewenangan

**One Workspace. Full Visibility.** — Integrated Digital Workspace for BagRenmin

## Scope

Adds server-side short-lived, revocable **limited delegation**, managed by Superadmin from React. This is not a generic unlimited policy editor, and it does NOT activate permission-protected operational document endpoints before R3.

- Sources: active `sdl_access_grants` of scope `unit`, role active, source user active, unit active, no identity/audit privileged permission in role.
- Recipient: active non-Superadmin user, completed first password rotation, placed in **same** unit.
- Permissions: explicit subset of source role permissions, only read/create/update within **same module+unit**; no approval, export, audit, role/user administration.
- Classification: `biasa` or `penting`, capped at source classification limit. **Rahasia never delegated** in R2C2B.
- Duration: starts at creation, expires after at most **14 days** and never after source grant expires.
- Scope: `assigned` or `unit`, never cross-unit.
- Lifecycle: immutable grant details, only `revoke` changes state. History remains. Creation/revocation requires reason and audit; recipient sessions revoked on changes.
- Revocation/expiry/source grant revoke/source user deactivation/role permission removal must be checked at **read time**. Storing delegation does not make it permanently valid.
- No delegation chain: delegated rights cannot be a source for a new delegation.

## API (all below `/api/v1/admin`, Superadmin + DB check + CSRF on POST)

- `GET /delegation-candidates` — active eligible full-unit source grants and allowed permission candidates.
- `GET /delegations` — latest 300 audit-visible delegations.
- `POST /delegations` — create limited delegation with source grant, recipient, scope, classification, selected permissions, expiry, reason.
- `POST /delegations/{id}/revoke` — revoke with version check and mandatory reason.

No endpoint exposes secrets or issues new credentials.

## R3 integration contract

`access.EvaluateForUser(ctx, pool, authenticatedID, permission, resourceFromDatabase, now)` loads effective direct and delegated grants with explicit permission/source checks and runs deny-by-default `access.Evaluate`. API endpoints MUST load the resource from PostgreSQL; never use unit/creator/assignments/status/classification from browser POST to authorize the same POST. The returned error must fail closed. Document list searches must apply equivalent SQL scope filtering; do not pull unrestricted rows and filter in React. No Superadmin bypass is allowed.

Approval delegation (and classification Rahasia) remains CLOSED pending dedicated workflow/authorization review at R3; role editor permission alone does not activate approval.

## Gate after Mac install

1. Docker build runs Go unit tests and React TypeScript build, then applies migration 005 transactionally.
2. Verify three containers healthy, existing Superadmin login + OTP retained.
3. From Role & Permission Editor, create non-privileged Urmin role with selected permissions; assign `unit` scope to source user via User Management. Recipient must also belong to Urmin.
4. As Superadmin, create delegated `read` permission, refresh, verify persisted history, revoke with reason.
5. Confirm denial of cross-unit recipients, `identity.*`, `*.approve`, expiry beyond 14 days, source revoke, unauthorized role, missing CSRF, and no role elevation. DB/API integration security tests still pending until performed.

## Security & operations

- PostgreSQL migration `005_access_delegation.sql` is additive. No TRUNCATE, DROP, DELETE, destructive column changes or volume recreation.
- Do not post `.env`, SMTP password, OTP, session cookies or user temporary passwords.
- R2C2B is only considered complete after Mac build + functional + negative tests.
