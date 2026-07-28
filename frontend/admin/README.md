# Admin Console

The restricted internal console supports customer service, job/source moderation, contribution review, workflow diagnosis, provider status, entitlement support, privacy requests, and emergency feature/adapter controls.

## Planned subfolders

- `app/` — Authenticated admin routes and layouts.
- `features/` — Support, trust, jobs, workflows, billing, and privacy tools.
- `components/` — Admin-only tables, timelines, filters, and redacted viewers.
- `lib/` — Privileged API client and authorization helpers.
- `tests/` — RBAC, audit, redaction, and end-to-end tests.

Admin access is least-privilege and audited. Sensitive values remain redacted, and break-glass actions require a reason and a time-limited grant.
