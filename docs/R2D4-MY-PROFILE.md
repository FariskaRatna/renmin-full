# Siera Delta Lima — R2D4 My Profile & Avatar

Scope: self-service profile for **all authenticated users**, including the restricted Superadmin. No operational grant is added.

## Endpoints

| Method | Path | Control |
| --- | --- | --- |
| GET | `/api/v1/auth/profile` | authenticated session |
| PATCH | `/api/v1/auth/profile` | session + origin/CSRF; display name and phone only |
| GET | `/api/v1/auth/profile/avatar` | authenticated session; self avatar only |
| PUT / DELETE | `/api/v1/auth/profile/avatar` | session + origin/CSRF |
| POST | `/api/v1/auth/change-password` | existing password rotation with current password, >=14 new characters, revokes other sessions |
| POST | `/api/v1/auth/profile/email/start` | session, origin/CSRF, current password, request throttle, SMTP required |
| POST | `/api/v1/auth/profile/email/verify` | session, origin/CSRF, six-digit one-time HMAC, five-minute expiry, five attempts |

Avatar may be selected in JPG/PNG/WebP on supported browsers; React converts to JPEG locally. Go decodes JPEG/PNG, rejects too large or oversized images, crops and re-encodes 256×256 JPEG stripping metadata. Only JPEG bytes are stored privately in a PostgreSQL `BYTEA` field. No public upload directory, external CDN or external image host. Avatar endpoint does **not** accept a user ID.

**Email change** is only committed after an OTP reaches and is verified at the new address. Challenges are stored hashed, expire in five minutes, max five attempts, and request creation is capped at 3 per 15 minutes per account. An authenticated user's old session may remain; all other sessions are revoked upon confirmed change. Audit events contain no password, OTP or image data.

**Limitations and review gates:** server-side integration and Docker build must pass on the user's Mac. Validate login for Superadmin and Operator, avatar content checks, expired/wrong OTP, CSRF rejection, email uniqueness, session revocation, no access to other users' photos, and that Superadmin is still denied all operational routes. Security review before production is mandatory.
