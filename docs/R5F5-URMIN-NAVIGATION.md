# R5F5 — URMIN Navigation Simplification

Scope: frontend navigation only, no API / RBAC / schema changes.

Operational sidebar (URMIN): Dashboard, Surat Masuk, Surat Keluar, Disposisi, Berkas Kerja, Agenda & Rapat, Arsip. Admin-only: Pengguna & Hak Akses.

- Surat Masuk tabs: Daftar Surat (existing registry), Inbox (R5F2), Riwayat Penerimaan (received records visible to the signed-in recipient only; **not** a global outgoing-distribution archive).
- Disposisi tabs: Tugas Saya, Diberikan, Perlu Review, Riwayat (completed tasks not awaiting review in the existing capped R5F3 list). Each keeps existing API actions, details, review, timeline.
- Berkas Kerja: list and detail R5F4; in selected record, Lampiran, Tugas Internal, Riwayat. No cross-record aggregate task view is implied.
- Surat Keluar, Agenda, Arsip retain real R5D registry views; do not introduce mock tabs that lack corresponding queries.
- Admin tabs: Pengguna and Role & Akses using existing components; Kewenangan brief. Admin tabs visible only to existing superadmins, not broader access.
- Global header hides duplicate Inbox/Tasks shortcuts only while in URMIN; other workspaces retain their existing global shortcuts. Roadmap remains accessible to superadmins under Manage.
- Existing dashboard actions continue to open records, routed to canonical menus. Other units' navigation is unchanged.
- No component removes backend access checks.

QA after install: login URMIN, navigate 7 operational menus, confirm Inbox notification and detail/receipt, try all four Disposisi tabs and detail, open Berkas and switch 3 detail tabs, check admin/non-admin sidebar, check mobile/collapsed sidebar, light/dark, verify dashboard deep links and return-to-portal, confirm other three units unchanged.
