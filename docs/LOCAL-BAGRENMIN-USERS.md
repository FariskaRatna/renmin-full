# Siera Delta Lima — Initial Operational Accounts (local development only)

This is a one-time, manually authorized database provisioning operation, **not** a schema migration. It updates only the existing `op-urmin` unit membership and scoped Urmin role/grant, after explicitly verifying it has no roles, grants, or other units. It does not alter its email, password, OTP setting, or profile. It requires a healthy pre-existing `sdl_root_dev` database, a current Superadmin username and password, and an explicit `CREATE-12-LINK-1` confirmation.

| Unit | Username | Role / scope | Classification |
|---|---|---|---|
| Urmin | op-urmin | Operator / own | biasa |
| Urmin | staf-urmin | Staf / own | biasa |
| Urmin | ka-urmin | Kepala Urmin / unit | penting |
| Subbagren | op-subbagren | Operator / assigned | biasa |
| Subbagren | staf-subbagren | Staf / assigned | biasa |
| Subbagren | kasubbagren | Kasubbagren / unit | penting |
| Subbagsumda | op-subbagsumda | Operator / assigned | biasa |
| Subbagsumda | staf-subbagsumda | Staf / assigned | biasa |
| Subbagsumda | kasubbagsumda | Kasubbagsumda / unit | penting |
| Subbagbinfung | op-subbagbinfung | Operator / assigned | biasa |
| Subbagbinfung | staf-subbagbinfung | Staf / assigned | biasa |
| Subbagbinfung | kasubbagbinfung | Kasubbagbinfung / unit | penting |
| BagRenmin | kabagrenmin | Kabagrenmin / unit grants for all 4 units, read-only operational permissions | penting |

Each of the 12 NEW users gets a placeholder email `username@siera.invalid` (non-deliverable). Real email addresses must be configured and verified before any email-recovery or OTP workflows. Each NEW user's initial password is read from terminal without echo; each account gets a distinct Argon2id salted hash, mandatory first-login password change. OTP is OFF for the 12 NEW users. The existing `op-urmin` policy is preserved (currently OFF). Existing Superadmin remains untouched and OTP is enforced in the Go authentication service.

Roles are created as 13 independently editable, non-system roles in the Role Editor; only currently defined permissions are assigned. The role definitions and least-privilege grants are detailed in `cmd/seed-bagrenmin/main.go`. Classifications and scopes are backend-enforced. Permissions for not-yet-implemented modules do not make them functional.

The entire transaction rolls back on collision or error; no existing user passwords are reset, and no migrations are modified. If existing `op-urmin` has acquired any roles, grants, or another unit, the script refuses to proceed. Only `sdl_user_units` for Urmin and a scoped `sdl_access_grants` row are added for it, with an audit event. Creates audit entries under the Superadmin identity after verifying its password locally, with explicit provisioning source metadata. **This is a local development/acceptance convenience, not a recommended production user-enrollment process**: shared starting credentials and disabled OTP are unsafe in production.

After provisioning, login at http://127.0.0.1:5174, complete CAPTCHA, and change each user's initial password. Confirm that Urmin can create its own drafts and that intended Subbag recipients appear in the Inbox (only after their password has been changed). Disable/delete test accounts and enable OTP with real verified email addresses before a production deployment.
