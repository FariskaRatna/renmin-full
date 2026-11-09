# SIERA DELTA LIMA — R2D1 Local CAPTCHA & OTP Policy

Scope: focused identity hardening release. R2D2 (simple permission controls), R2D3 (user table/modals), R2D4 (profile/avatar) and R2D5 (end-to-end testing) remain separate gates.

## CAPTCHA
- Standalone proof-of-work using React Web Crypto and Go stdlib `crypto/sha256`; zero third-party CAPTCHA services, CDN, external assets or remote verification.
- GET `/api/v1/auth/captcha` issues a DB-backed nonce challenge with two-minute expiry, 16 leading zero bits (expected 65,536 SHA-256 trials). Challenge is bound to server-observed connection IP, not untrusted `X-Forwarded-For`.
- CAPTCHA solver produces `{id,counter}`. Login `/api/v1/auth/login` rejects missing, invalid, expired or previously used challenges. Consumed transactionally before credentials are checked. Issuance rate is bounded per observed IP; login throttling remains active.
- A CAPTCHA reduces scripted bulk attempts; it does not prove the requester is human, replace OTP or guarantee protection against sophisticated automation. Keep rate limiting, logs, and later security testing.
- Browser must support Web Crypto; localhost is supported. Mobile performance and assistive technology support must be verified during R2D5.

## OTP
- New and existing non-Superadmin users default to `otp_enabled=true` in PostgreSQL migration 008.
- Superadmin OTP is unconditional in Go (`Superadmin || otp_enabled`); per-user editor rejects updates to Superadmin.
- Other accounts may be explicitly enabled/disabled in User Management; Superadmin re-enters their password and supplies a reason. Server-side admin session, Origin, CSRF, optimistic version check and audit remain required.
- OTP changes revoke target sessions and invalidate existing OTP challenges. When policy ON conflicts with an in-progress OTP-off login, the login fails closed and must be retried.
- With OTP OFF, after valid password + local CAPTCHA, backend creates a normal 8-hour session and audits `auth.login_without_otp`. Initial temporary password rotation remains mandatory. Role permissions and object-level ABAC remain unchanged.
- Re-auth attempts for OTP changes are throttled; passwords and OTP codes must never enter audit metadata or logs.

## Mac verification gates
1. Install with expected checksums; source backup created; run `./sdl-run.sh` with database volume unchanged.
2. Go tests/build + React build pass; migration 008 applied; DB, API, FE healthy.
3. Superadmin: local CAPTCHA → correct password → email OTP → authenticated portal; OTP switch shown locked ON.
4. Non-Superadmin with OTP ON: CAPTCHA → password → email OTP → authenticated; no bypass.
5. Non-Superadmin with OTP OFF: CAPTCHA → password → authenticated WITHOUT email; change password still required for new accounts.
6. Wrong password, expired or replayed CAPTCHA, malformed proof, invalid CSRF and exhausted re-auth attempts rejected.
7. After changing OTP, old sessions are revoked; role/object-level access and Superadmin operational restrictions unchanged.

Do NOT paste `.env`, passwords, session cookies, API secrets, OTP codes, database dumps or HMAC keys into chat. R2D1 is NOT production-approved until these gates and R2D5 are completed.
