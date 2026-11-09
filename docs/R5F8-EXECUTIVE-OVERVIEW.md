# R5F8 Executive Overview – BagRenmin

- Access point: Portal landing, above four unit cards. Only Superadmin and a Kabagrenmin identity may see the entry.
- API: `GET /api/v1/executive/access` (active capability probe) and `GET /api/v1/executive/overview?period=30d|90d|365d|all`. The portal link appears only after the access probe succeeds.
- Authorization: session + active user; Superadmin through role-editor channel; Kabagrenmin through operational channel and live `br_kabagrenmin` + `dashboard.cross_unit.read` role/grant verification. No unrestricted grant to raw operational records is created. Server denies other roles even if they bypass UI.
- **Aggregate-only**: no person names, document contents, attachments, or underlying evidence in the response. Non-operational Superadmin can view only permitted aggregate summaries, not browse the units' records.
- URMIN: registered incoming; outgoing register; disposition tasks; overdue and Kabag queue.
- Subbagren: currently verifiable work registers, pagu entries and verified pagu/realisasi. Planning document progress, proposal completion and official realization rates remain pending definitive business model mapping.
- Subbagsumda: current personel and BMN entry counts, BMN condition by category, grouped personel by `unitKerja` (top groups, groups below 3 merged as Other). BMN **quantity** and geographic distribution are NOT claimed because these measures are not normalized by region in the current registry. Further drilldown requires an approved regional master.
- Subbagbinfung: SOP entry counts and final metadata status; final is **not equivalent to formal signing or approval**. Evaluasi entries count separately.
- Select period, refresh, select unit, view breakdown and Urmin six-month incoming trend. Flow metrics apply selected period; personel, BMN, SOP and open attention are current snapshot figures. Trend is always six months. Missing data sources display unavailable, never synthetic zeros.
- Existing API, PostgreSQL rows, grants and migration history remain unchanged. No schema migration.
- Security: protect aggregated endpoint server-side, ensure existing session cookie/CSRF policy, no-cache, RBAC and access audit controls. Confirm statistical aggregation disclosure policy before production.
- For testing: login as active Kabagrenmin and Superadmin; login as Urmin operator and verify 403 for `/api/v1/executive/overview`; test expired/revoked Kabag grant; confirm no exposed person names or document titles. Test no data/large values, both themes and small screen.
