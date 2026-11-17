---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance (accessibility, focus, forms, typography, layout, performance, copy). Use when asked to review UI, check accessibility, audit design or UX, or check a page against best practices.
argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review the given files against the rules in `guidelines.md` in this folder.

1. Read `guidelines.md` (local snapshot; do NOT fetch rules from the internet).
2. Read the specified files, or ask which files to review if none were given.
3. Check every applicable rule and report findings in the terse `file:line` format the guidelines describe.

For SIERA DELTA LIMA, where a rule conflicts with `docs/UIUX-DESIGN-SYSTEM.md` or the WCAG rules in
`.claude/agents/ui-ux-designer.md`, report the conflict instead of silently choosing one.

Source: vercel-labs/web-interface-guidelines (MIT), snapshot of command.md at commit 434b7f9.
Original skill: vercel-labs/agent-skills, adapted to read a local copy instead of fetching remotely.
