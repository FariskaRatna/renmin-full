# SIERA DELTA LIMA — R5E UX03A Scale & Unit Color Accents

## Purpose
Improve the established R5E UX03 premium portal visually without adding sections or changing navigation: a wider/higher hero, more readable title, larger workspace cards and the original color identities for each unit.

## Visual specification
- Hero: max content width 1250px at desktop, min height 322px, navy mesh gradient, existing watermark `/logo.png`.
- Four cards: desktop min height 213px, softened individual tint, colored 3px upper accent border, appropriately scaled icons and typography.
- Unit colors are the existing values declared in `App.tsx` (teal, blue, purple, amber), not hard-coded twice in CSS.
- On tablets use two columns; on narrow mobile screens use one column.
- Preserve native focus outline, `prefers-reduced-motion`, dark mode, tagline, Roadmap navigation and footer sticky-bottom logic.

## QA / status
- Styling only: no changes to API, authentication, DB or CRUD/disposition flows.
- ZIP and installer are checksum protected; idempotent and source-backed up.
- Mac Docker build, responsive browser check and operational E2E remain pending until separately verified.
