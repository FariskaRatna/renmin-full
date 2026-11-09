# R5E UX04A — Layout Finishing

Scope: footer pinned to bottom of visible viewport on authenticated screens; scrollable dashboard content never hidden behind the footer. Sidebar remains independently scrollable and supports desktop collapse/mobile drawer.

Unit dashboard has one primary unit heading from `App.tsx`; SmartUnitDashboard keeps only a compact `RINGKASAN DATA` label plus period/refresh controls.

Canonical official label: **BagRenmin Densus 88 AT Polri** on header brand, browser metadata and footer. Keep `One Workspace. Full Visibility.` tagline unchanged.

## Manual verification (Mac)

1. Scroll Urmin/Subbagren/Sumda/Binfung dashboards; footer must remain in same viewport position and not cover chart controls.
2. Scroll collapsed/expanded sidebar; footer must remain visible and sidebar button accessible.
3. Verify navigation/portal and mobile narrow width; footer must not overlap app buttons.
4. Ensure former `Workspace Overview` duplicate heading is gone and new name is visible in header/footer/browser title.
5. Confirm dashboard filters and chart links still work.

No backend, schema, role, login, or operational CRUD changes.
