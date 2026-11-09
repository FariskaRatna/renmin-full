# R2A Schema and Operation Guide

This patch **does not activate login** and intentionally creates **no accounts, default passwords, sessions or document records**. It prepares a relational foundation for security features that are implemented/tested in R2B/R2C.

## Schema
- `sdl_org_units`: Urmin, Subbagren, Subbagsumda, Subbagbinfung.
- `sdl_users`, `sdl_roles`, `sdl_permissions`, `sdl_user_roles`, `sdl_user_units`, `sdl_role_permissions`.
- `sdl_sessions`, `sdl_login_challenges` (hash only), `sdl_login_limits`, `sdl_audit_events`.
- `sdl_schema_migrations` with SHA-256 checksum tracking.

Only identity-management permissions are seeded for `superadmin`. No permission to read or modify documents is granted by that role. Operational access must also be scoped to assigned units. Roles `administrator`, `operator`, and `pimpinan` start without automatic privileges. The schema is a starting point, not a security gate by itself.

## Applying migrations

`./sdl-run.sh` builds API/FE, starts PostgreSQL, calls the API image **once in migration mode**, then starts API/FE and verifies service health. Migration mode uses a transaction-level advisory lock, ledger + checksums. If a SQL migration fails, the transaction is rolled back and startup stops. The API refuses normal startup if an expected migration is not recorded.

The SQL files are compiled into the Go binary via `go:embed` from `apps/backend/internal/migrations/sql/`. Do not edit an applied migration; create a new numbered migration instead.

The original R1 PostgreSQL Docker volume (`sdl-foundation-r1_sdl_root_r1_pgdata`) and Compose project name are **preserved**. No `down -v`, truncate, drop or database recreation is used.

## Gate to R2B

Verify build tests and fresh Compose health, then review DB schema. After R2A passes, proceed to interactive Superadmin bootstrap, SMTP configuration, login/session implementation and end-to-end security tests.
