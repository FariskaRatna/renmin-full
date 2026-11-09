# R5B Subbagsumda — Functional CRUD

Dedicated PostgreSQL register for Personel, Pendidikan/Pelatihan, and Inventaris/BMN. New `sdl_sumda_registry` rows link to `sdl_unit_work_records` (R5A) to use one shared attachment/disposition ledger. Each master entity is soft archived, audit events append, and edit uses version checks.

UI: select **Subbagsumda** and open Data Administrasi Personel, Pendidikan & Pengembangan SDM, or Inventaris & BMN. Form fields save to DB; from each row click **Foto/PDF & Disposisi** for authenticated upload/download and internal assignment.

API: `GET/POST /api/v1/subbagsumda/registry/?kind=personel|pendidikan|inventaris`, `GET/PATCH/DELETE /api/v1/subbagsumda/registry/{id}`. Existing session CSRF and unit grants enforced. Superadmin denied. There is no bypass for first-login password change and no grant created by migration. Unique code enforced for active rows of each kind.

**Scope limit:** Not HRIS/BMN official inventory; no full personnel number/PII ingest, photo recognition, document scanning, malware scanning, cross-unit assignments or external financial/BMN system integration. Use synthetic data for browser tests. Browser actions must be verified on Mac before marking functional PASS.
