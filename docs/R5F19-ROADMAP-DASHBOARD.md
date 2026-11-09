# R5F19 — SIERA DELTA LIMA Roadmap Management

- Deadline: **31 Desember 2026**.
- Role: Superadmin only; `/api/v1/admin/project-roadmap` behind existing session, Origin/CSRF, explicit Superadmin authorization.
- Data: seeded from reviewed 23 Oktober 2026 roadmap (41 work items, 6 milestones, 14 decisions/risks, 13 version logs). Existing database data is not deleted, migrations are additive.
- Tabs: Dashboard, Master Roadmap, Kurva S, Milestone, Keputusan & Risiko, Jejak Versi.
- Roadmap status and management note can be updated with version checking and append-only audit. Backend updates snapshots on change (Asia/Jakarta date).
- Actual completion: number of roadmap items with status **Teruji** / total roadmap items. No fabricated earlier actual snapshots or arbitrary percentage for in-progress items.
- Planned S-curve: unweighted smoothstep projection from the verified baseline 23 October 2026 to 100% on 31 December 2026; illustrative schedule pending agreement on task weights and target dates.
- Existing operational modules, grants, SMTP and workflow untouched.
