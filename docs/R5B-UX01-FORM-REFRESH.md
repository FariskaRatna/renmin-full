# SIERA DELTA LIMA — R5B UX01 (Functional UI Refresh)

Scope: Subbagsumda **Data Administrasi Personel**, **Pendidikan & Pengembangan SDM**, and **Inventaris & BMN**. No endpoint, schema, role, grant, session or file storage changes.

## UX updates
- New modal form with highly visible bordered inputs, placeholders, required-field indicators, grouped sections, and sticky action footer.
- Mobile friendly single-column form, desktop two-column form, modal supports Escape and click-outside closure when not saving.
- New overview metrics based on returned API records (not seed/dummy data), table, meaningful empty state, search, sorting, refresh, archive and file/disposition shortcuts.
- Scoped CSS to avoid conflicts with global authentication or Tailwind styles; supports existing dark theme.
- Existing R5B API (`/api/v1/subbagsumda/registry/`) and request/response contracts remain unchanged.

## Validation
- Browser smoke test **pending**: test Create, edit, search, refresh, archive and File & Disposisi for all three Subbagsumda menus.
- Full Go / Vite build **pending on Mac**. Source TSX parsing and CSS parser checks done during patch preparation.
- Version not marked functional PASS until tests performed in authenticated browser with active Subbagsumda grant.

## Change safety
- Installer verifies exact R5B SHA-256 baseline, snapshots original `SumdaR5B.tsx`, and does not touch PostgreSQL.
- Reinstall idempotent; unknown/modified source is rejected before writes.
