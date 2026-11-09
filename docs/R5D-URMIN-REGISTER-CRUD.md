# R5D — Urmin Functional CRUD

Scope: three existing menus activated: **Surat Keluar**, **Agenda & Rapat**, **Arsip & Dokumentasi**.

## Live behavior

- Backend `/api/v1/urmin/registry/` supports `GET /?kind=...&q=...`, `POST /`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}`. Existing sessions and CSRF apply. Active unit grant/classification enforced by shared R5A `permit`; Superadmin access only under existing local DEV demo gate.
- Migration 023 creates `sdl_urmin_registry` with unique code per kind among active entries, opaque `work_record_id` linked to R5A. Each new register entry creates the related R5A parent. Photo/PDF/dispositions are reached through the existing File & Disposisi action. No parallel file store.
- Register code is **internal**, not automatically assigned formal nomor surat. `nomorSurat`, if provided, is manually entered and not authoritative. No electronic signature, approval, sending or official archive destruction.
- Archive button is **soft-delete**. A register with pending/received internal dispositions cannot be soft-archived until those tasks finish or cancel.
- Only dummy/fictional information while security/privacy/production gates and browser E2E are pending.

## Functional Mac test

1. Superadmin DEV mode: create an outgoing-letter draft with internal code and date, save and refresh; change target and status, save again; upload dummy PDF and download; create an internal disposition, then receive/complete using permitted test users.
2. Create agenda record with date and time, attach dummy photo, save and refresh; verify date/time persists.
3. Create archive metadata with dummy document and storage location, view/edit/archive; ensure it disappears from active list but old R5A audit record remains.
4. Confirm existing official Urmin Surat Masuk and Disposisi are unchanged; production-like testing still requires different roles, sessions and paper trail.
