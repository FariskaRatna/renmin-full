# R5F15 — Surat Masuk & Premium Login Compatibility

- Fix R5F14 installer conflict: apply R5F14 authentication screen to **R5F11 App.tsx**; preserve URMIN tab navigation and dashboard routes.
- SMTP header display name **No-Reply Siera Delta Lima**; SMTP address unchanged.
- Preview local PDF/JPG/PNG before submit; private preview for stored attachments via authenticated endpoint and temporary blob URLs.
- More specific intake submission failure messages for permission vs Kabag recipient eligibility.
- No automatic permission grants: role templates alone do not establish effective grants. Staff URMIN can submit only if effective create/upload permissions and Kabag recipient eligibility match.
- No DB migration, changes to auth/OTP challenge logic, or changes to private attachment API.
- After installing, use existing `./sdl-run.sh`, then test staff submission for `biasa` first and check `kabagrenmin` receive grant.
