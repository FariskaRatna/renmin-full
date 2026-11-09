# R5F9 — Surat Keluar: Register UX (URMIN)

## Scope
This patch changes only the existing UrminR5D Surat Keluar experience, while keeping Agenda and Arsip using their established R5D behavior. No API, migration, RBAC, or database changes.

### Implemented
- Filter tabs by the **recorded administrative status**: Semua, Draft, Diregister, Menunggu TTD, Dikirim (Catatan), Tanpa Status. Filter counts apply to up to 100 records already loaded by the API, not to all historical records.
- Outgoing register list shows internal register code, manual official letter number (if filled), subject, recipient, letter date and recorded status. Classification *Penting* remains visible.
- The existing **Tambah / Edit** modal remains and is clearer: default draft status, explanatory note, same-form PDF/photo upload, authenticated preview/download, and queued-upload retry handling inherited from R5D. Drag & drop added to the upload target.
- "Berkas Kerja" points to the original Unit Work record (no duplicate attachment store or disposition engine).
- Client-side filters are not authoritative and never confer grants. Existing session, CSRF, existing permission checks, and audit trail remain in charge of writes.

### Important limits
- `statusAdministrasi` is free-form operator-managed *metadata within a controlled list*. It is NOT an enforced approval state machine. **Dikirim (dicatat manual) does not prove delivery.** No electronic signature, official letter-number generator, approval, auto-email or actual letter dispatch is implemented.
- Saved outgoing registry and attachments are handled by two existing endpoints; a failed upload may leave the registry stored and still require a retry. The UI says so. No claim of cross-endpoint atomicity.
- Search on the server currently supports internal code and title; filters are based on the API's visible 100 results. For missing older entries use server search.
- R5F9 has no schema migration. Official signatory and review workflow require an agreed SOP and backend authorization/state model before implementation.

### Acceptance checklist on Mac
1. Execute the exact-baseline installer (only after R5F8 is installed), then `./sdl-run.sh` from the project root.
2. Open URMIN -> Surat Keluar. Create a draft with internal register code, subject, target, date; upload a small PDF/JPG. Verify list, preview, download, and refresh.
3. Filter Draft -> Diregister -> Menunggu TTD -> Dikirim (Catatan), including an entry without status. Check warning says manually recorded.
4. Edit an existing entry and attach an image via drag/drop; verify uploaded asset after refresh.
5. Confirm Agenda & Rapat / Arsip CRUD still function and classification permissions still enforce server-side.
6. Confirm a non-granted user cannot create/edit/delete/upload by manually calling the API.
