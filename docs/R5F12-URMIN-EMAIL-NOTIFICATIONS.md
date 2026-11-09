# R5F12 | Email Penugasan URMIN

## Scope
Transactional outbox for R3C issue, R3D2 forward, R3C complete and R3D review. Only tasks with `unit_key=urmin` create notifications; all other units are unaffected. This does **not** grant permissions, create users or change task access.

## Behavior
- Events and email queue are committed together with each authorized task change.
- A background worker sends generic, non-sensitive email through existing SMTP TLS configuration (465/587), using no new email credentials.
- Failed sending retries with backoff and reaches `failed` after six attempts. `sent` means SMTP server accepted message; not proof of inbox delivery/read receipt.
- Empty or invalid recipient email ends in `failed` and may be remediated by an authorized admin. No historic emails are sent automatically.
- SMTP configuration absent: worker stays inactive, outbox is preserved for later delivery.
- Explicit emergency disable: `SDL_EMAIL_NOTIFICATIONS_ENABLED=false` in API environment.
- This build does not include recipient self-service email verification beyond existing profile email OTP.

## Pre-demo account readiness
According to 2026-10-23 assessment: `kabagrenmin`, `ka-urmin`, `staf-urmin`, `op-urmin` are active, email syntax present but mailbox not verified, all lack effective `urmin.disposisi.execute`; `ka-urmin` and `staf-urmin` must change their passwords. Address grants in User & Access Management with least privilege; do not grant execute to every account automatically.

## Security
Messages contain no letter title, instruction, attachment, classification or sensitive personal details. Authorization to view work is checked at the portal/backend, not via email. SMTP credentials must remain in the environment/secret manager, not in scripts or committed files. Do not enable plaintext SMTP ports.

## Validation
1. Configure and test the existing OTP SMTP TLS 465/587; ensure recipient owns working mailbox.
2. Correct `must_change_password` and effective unit grant/permission with real operational accounts.
3. Create a test distribution and receive it as the authorized issuer; issue a URMIN disposition to the recipient.
4. Validate `sdl_urmin_email_outbox` event and `sent` status through the existing protected database connection; inspect destination mailbox. Use `failed`/`error_code` to troubleshoot without displaying confidential content.
5. Accept/complete/review to exercise the remaining notices; verify no notices arrive for other units.

## Limitations
No web deep-link is included until a shared HTTPS app URL is configured. This patch does not add progress-percentage reporting, Kabagrenmin intake notifications, or unit-work task email: it covers **URMIN disposition task** notifications only.
