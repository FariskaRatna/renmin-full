# SIERA DELTA LIMA — UI/UX Design System v1

Source of truth for visual design: user-supplied `renmin(1).html` (October 2026).

## Brand
- Name: **SIERA DELTA LIMA**
- Tagline: **One Workspace. Full Visibility.**
- Subtitle: **Integrated Digital Workspace for BagRenmin**
- Official asset is `apps/frontend/public/ds.png`; fallback shield icon used until asset provided. Never redraw/replace official logo as if it were official.
- All wording is practical, professional Indonesian; technical terms retained where clearer.

## Visual tokens
| Item | Light token | Usage |
|---|---|---|
| Canvas | `#f5f7fb` | Background |
| Surface | `#ffffff` | Cards, header, panels, table |
| Primary ink | `#14243e` | Titles/content |
| Sidebar navy | `#111f35` | Unit workspace navigation |
| Gold | `#d5ad67` | Brand highlights, current navigation |
| Border | `#e5eaf1` | Surfaces/dividers |
| Green | `#2b9a80` | Urmin |
| Blue | `#4b78ba` | Subbagren |
| Purple | `#956db9` | Subbagsumda |
| Amber | `#ca9250` | Subbagbinfung |

Use CSS custom properties for light/dark tokens, with readable dark backgrounds and contrast. No CDN, remote font or runtime external style dependencies; Tailwind compiled locally.

## Consistent component conventions
- 75px sticky top header (67px mobile), brand + official image fallback, compact navigation, theme toggle.
- Portal hero: dark navy gradient, gold eyebrow and accents, white heading, two-line tagline.
- Unit workspace: navy sidebar, active gold marker, breadcrumb, 4 stat cards, consistent service cards.
- Operational table: action/search toolbar, neutral column headers, clear empty state. Nonfunctional actions stay **disabled** until APIs exist.
- Login: split navy hero + white form on desktop; single-column form on mobile. R2B-UI is a **preview**, does not accept credentials.
- Workflows: status/timeline components remain preview-only until operational backend events exist.
- Accessible button labels and focus outlines; smooth scrolling respects `prefers-reduced-motion`.

## Data & authorization rule
- Never seed fake document counts/activities just to fill cards.
- Do not use frontend hiding as RBAC implementation. Enforcement must live in Go API with unit scope and resource checks.
- Security metadata is never persisted in localStorage; only safe theme preference.
- Confidential/secret documents require explicit security modeling; demo labels are not authorization.

## Implementation & review
- Shared responsive React components live in `apps/frontend/src/App.tsx`, with `style.css` as the central visual token stylesheet.
- Actual feature modules will be broken into folders/components when their Go APIs are implemented; do not fork styles per module.
- After patch: run `./sdl-run.sh`; verify browser at `http://127.0.0.1:5174` desktop and phone view, dark/light, all four units, roadmap and login preview.
