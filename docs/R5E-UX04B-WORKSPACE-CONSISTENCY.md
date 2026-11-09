# R5E UX04B — Workspace Layout Consistency

Change type: frontend-only. Baseline: R5E UX04A. No database migration, credential, role, or permission changes.

## Fixed routes
- Header Inbox and Tasks remain in the current unit workspace shell, retaining collapsible navigation; default unit Urmin when opened before visiting any unit.
- Unit sidebar Inbox/Tasks uses the same component. Other operational unit routes already run within the workspace shell.
- Profile, Roles, Users and Roadmap continue as global pages by design.

## Screens
- Berkas: searchable register, visible inputs within add/edit dialog, contextual details, upload links, task assignment and history.
- Inbox: real summary counts, local search/status filter over authorized items, detail panel, attachments and existing receive/disposition functions.
- No dummy statistics or new privileges.

## Verification required on Mac
Run installer + `./sdl-run.sh`, then review desktop/mobile: both header Inbox and sidebar Inbox, Tasks, collapse/expand, switch units, form controls and click-through interactions. Build/source review alone is not browser E2E.
