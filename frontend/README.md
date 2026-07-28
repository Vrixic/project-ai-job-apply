# Frontend

This directory contains every user-facing client. Frontends consume versioned contracts from `packages/api-contracts` and must not import backend implementations or access databases directly.

## Subfolders

- `web/` — Candidate web application and public job/marketing pages.
- `mobile/` — Limited iOS and Android companion application.
- `extension/` — Chrome/Edge extension for saving jobs and ATS-assisted application work.
- `admin/` — Internal support, moderation, trust, and operations console.

Shared visual primitives belong in `packages/design-system`; client-specific screens and navigation stay in their application folder.
