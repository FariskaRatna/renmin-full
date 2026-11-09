# R5E UX04 — Interactive Unit Dashboard & Collapsible Sidebar

## Scope
Frontend only: `App.tsx`, `SmartUnitDashboard.tsx`, `SmartUnitDashboard.css`, `DevelopmentChecklist.tsx`, `docs/ROADMAP.md`. No DB migrations, accounts, grants, new packages, background jobs, or backend changes. Original hero/logo/footer unchanged.

## Interactive behavior
- Select 30, 90, 365 days, or all time; counts and activity trend recompute from permitted records.
- Click the trend chart interval labels, registry distribution bars, or status legend to filter Recent Activity. Click Clear filter to reset; toggle full/compact activity list.
- Click an activity or Quick access to open the matching operational CRUD module. Refresh fetches actual current data.
- Sidebar desktop collapses to icon-only mode with title/accessible labels; persisted under `sdl-sidebar-collapsed` for the current browser. Mobile sidebar uses existing drawer/hamburger.
- For Subbagren, verified pagu/realisasi amounts and ratio reflect the existing yearly budget summary when authorized.

## Important correctness boundaries
- Each unit reads only existing authenticated GET endpoints; HTTP 401/403 and network errors are not transformed into authoritative zero counts. A visible warning indicates incomplete accessible sources.
- No dummy chart data or hardcoded financial values. Categories/statuses derive from actual list records. Date filters omit records without a usable date from that window; All time includes them.
- Counts are for rows returned by existing list APIs; pagination/limits/access grants may mean they are not whole-organization totals.
- Urmin Incoming data shows only records visible to the authenticated account.
- All mutation and assignment actions remain in existing CRUD/Disposisi modules, unchanged.

## Verification
Installer simulation and syntax can pass locally, but full Docker build and browser interaction must be checked on Mac. Test sidebar collapse, cross-menu persistence, mobile drawer, 4 workspaces, filter/chart clicks, refresh, empty data, partial-403 data, and navigation to a CRUD record category.
