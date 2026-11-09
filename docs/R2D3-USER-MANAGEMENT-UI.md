# SDL R2D3 — User Table & Modal UX

Source-only frontend patch, based on the approved `renmin.html` design language. Preserves backend Go, R2D1 CAPTCHA/OTP, R2D2 role toggles, PostgreSQL and all sessions.

## User flow

- A single data table lists users returned by `/api/v1/admin/users` (current Go API bound: 500 newest users). Search and filters operate over this returned subset and pagination is client-side (10 entries/page); not a server-wide search across an arbitrarily large user base.
- Add User launches a modal collecting username, display name, email, creation reason. Calls existing `POST /api/v1/admin/users`. A generated temporary password appears once in a second modal and vanishes from React state when closed. User must perform OTP and forced password change.
- Edit User opens a modal with three tabs: Profile (PATCH user), Role & Unit (PUT access), Security & OTP (PATCH OTP). Each save calls Go API with session credentials, CSRF and appropriate optimistic version. OTP additionally requires Superadmin password confirmation and reason.
- Superadmin is displayed but cannot be edited here; future self-service profile editing belongs to R2D4.
- Audits are fetched from the existing admin endpoint, shown on demand and never include passwords/OTP.

## Security and testing

Existing server authorization controls are not replaced by React. Changes to role/unit, status and OTP revoke user sessions by the Go backend. The UI never assumes any role has document access; ABAC remains enforced at resource endpoints. The modal has Escape handling and keyboard focus cycling. It does not expose an unimplemented photo upload or reset-password button.

Mac verification required: build, login, create/edit user, filter/pagination, role assignment persistence, negative API checks and audit. R2D3 is not complete until these pass.
