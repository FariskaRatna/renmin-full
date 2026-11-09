# R5F13 — Template Email SIERA DELTA LIMA

- Baseline: R5F12 notification outbox and pre-existing OTP SMTP sender.
- Scope: HTML email + plain-text fallback for both login/profile email OTP and URMIN disposition notifications. Both reuse SMTP TLS existing, no new environment variables or background services.
- Branding: **SIERA DELTA LIMA** / **BagRenmin Densus 88 AT Polri**, responsive table-based inline email CSS, no trackers, links, remote images or fonts.
- OTP: six-digit code as before, 5-minute validity as before. Transport/auth/session logic not modified.
- URMIN notifications: distinct subjects for assigned, forwarded, completed, review approved and review revision; generic content, navigation to URMIN > Disposisi. No actual task/letter detail sent by email.
- Rollback: installer backs up every existing changed file and verifies exact baseline checksums; reinstall is no-op. No migration, account/grant update, or SMTP credential change.
- Testing: gofmt, Go `go test ./internal/auth ./internal/notifications` and Docker complete build on user's Mac; verify OTP login, OTP profile email update and a real URMIN task notification. Check email clients on desktop/mobile, spam folder and sender reputation separately.
- Limitation: SMTP `sent` means mail server accepted it; not necessarily mailbox receipt. The app currently uses a localhost URL; no externally usable deep-link is provided.
