# R5F23A — Arahan Pimpinan (Composer + Autosave)

Scope: refresh React UI for the independent Kabagrenmin directive workflow; preserve R5F23 route, issue flow, read/ack and monitoring logic.

- Copy: "Instruksi langsung Kabagrenmin kepada staf renmin".
- Composer-first responsive interface, add/remove recipient chips, search across active staff, maximum 10 recipients, Biasa/Penting/Kilat, kind and optional due date.
- Draft stored server-side in PostgreSQL, one private draft per authorized Kabagrenmin user. No localStorage of directive contents.
- Autosave debounced 800ms, explicit Save now, restore on reopen, and Delete draft confirmation.
- Revision compare-and-swap prevents overwriting edits from another browser tab. Draft is checked and removed in the *same transaction* as sending; draft never generates recipient notifications.
- Sender-only draft APIs: GET/PUT/DELETE /api/v1/leadership/directives/draft; same existing auth + CSRF and Kabagrenmin role checks.
- No read rights to drafts for staff, BINFUNG editor, or Superadmin. No chat/reply is added.
- Additive migration 032; no changes to URMIN, roadmaps, portals, existing directive and recipient records.

Acceptance test on actual environment: Kabag opens new draft, writes text, chooses recipients, sees autosave; logs out and logs in, reopens draft; edits from two tabs cause 409 rather than silent overwrite; sends a real directive and confirms draft disappears and recipients see only the issued instruction. Also test mobile, light/dark, and 1/10/11 recipient validation.
