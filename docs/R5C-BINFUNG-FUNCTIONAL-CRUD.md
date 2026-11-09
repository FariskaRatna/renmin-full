# R5C — Subbagbinfung Functional CRUD

**Status:** source patch only; Mac build and browser functional E2E pending.

Six actual operational CRUD menus: SOP/Regulasi, Informasi & Dokumentasi (PID), RB/SPIP, Analisis Beban Kerja, Program Pembinaan, and Pembinaan & Evaluasi. Existing development-only Superadmin workspace access is preserved.

All records are stored in `sdl_binfung_registry` with a unique active code per category and a linked `sdl_unit_work_records` entry. Changes are transactional with optimistic version checks; archive is soft-delete and is blocked while linked assignments are pending or received. The R5A linked record is the single source for photos, PDF documents and internal dispositions. Do not duplicate uploads.

**API:** `/api/v1/subbagbinfung/registry/` (GET with `kind` and optional `q`, POST), `/{id}` (GET, PATCH, DELETE). All requests use current login/session/CSRF and per-record unit/classification policy.

**Functional testing:** Create one dummy record in each of six menus, refresh and search, edit and refresh, open Foto/PDF & Disposisi, upload a safe image and PDF, assign to active same-unit user, receive/complete and verify history. Then soft-archive a record without active assignments.

No new grant or password rotation; no secret data in test records. Existing Urmin and Subbagren workflows are unchanged.
