# R3D3: Final Approval & Progress Terpusat

Status: **Mac Docker build/health + isolated security suite 17/17 PASS pada 2026-10-20; Browser Functional E2E BELUM TERVERIFIKASI**.

## Scope

- `urmin.disposisi.final.submit`: Kepala Unit issuer root, requires permission review AND final.submit + active unit grant.
- `urmin.disposisi.final.monitor` / `.approve`: Only authorized `br_kabagrenmin` grant for each unit, with classification cap.
- Superadmin blocked by operational API middleware, role and grant checks.
- Final decision immutable once recorded; no modification to existing history.
- Data query: dashboard fetched from Go/Postgres every 60s; source of truth is DB. No fake percentage. Data limited to 151 most recent root tasks; counts not global.
- KPI: percentage is 90% × tasks that are completed and reviewed approved / total tasks; 100% requires Kabag final approval. This represents **workflow status**, not budget/spending/physical work.
- Manual setup: enable role permissions via Role Management and ensure Kabagrenmin has live per-unit grants in permitted classifications. Without grants, dashboard intentionally returns access denied.

## Validation gate

1. Mac installer, Docker build/health dan migration runner: PASS dari log user tanggal 2026-10-20; migration ledger individual masih perlu dicek preflight.
2. Mac security suite 17/17 PASS, termasuk 09e; tidak menggantikan pengujian browser.
3. Browser E2E with synthetic letter and valid scoped test accounts; verify revocation, one-time approval, manual/automatic dashboard refresh.
4. Do not claim production security from automated test alone.
