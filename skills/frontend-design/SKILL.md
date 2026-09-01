---
name: frontend-design
description: Route frontend creation or redesign work to the smallest bundled visual-design skill when the user requests design exploration, image-led direction, or a deliberately premium interface treatment.
---

# Route frontend design work

This package contains specialized skills under `skills/`. Use it only when visual design is a
material part of the request. Ordinary component maintenance, bug fixes, and accessibility fixes
do not need this package merely because they touch frontend code.

## Choose one focused mode

Inspect the subdirectory names, choose the smallest applicable mode, and read that mode's
`SKILL.md` completely before acting:

- Use `redesign-skill` when improving an existing interface without changing its behavior.
- Use `taste-skill` for a new marketing or editorial web surface.
- Use `minimalist-skill`, `soft-skill`, or `brutalist-skill` only when that visual direction is
  requested or clearly supported by the brief.
- Use `image-to-code-skill` only when a supplied or generated visual must drive implementation.
- Use `imagegen-frontend-web`, `imagegen-frontend-mobile`, or `brandkit` only when bitmap concept
  generation is part of the requested deliverable.
- Use `stitch-skill` only for a Google Stitch `DESIGN.md` deliverable.

Do not combine modes by default. The repository's product scope, factuality, accessibility,
security, privacy, and existing functional contracts override stylistic guidance. Preserve working
behavior and validate the resulting implementation with the affected frontend tests and build.
