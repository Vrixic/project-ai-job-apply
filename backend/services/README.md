# Backend Services

This directory contains business-domain modules. Each service owns its rules and data schema and communicates through versioned APIs or events.

## Subfolders

- `profile/` — Candidate facts, preferences, consent references, and answer vault.
- `jobs/` — Canonical jobs, sources, companies, and lifecycle.
- `matching/` — Retrieval, ranking, recommendations, and explanations.
- `documents/` — Resume and cover-letter versions and rendering state.
- `applications/` — Application packets, approvals, attempts, and technical history through confirmed submission.
- `outreach/` — Contact context, drafts, approvals, sends, and follow-ups.
- `notifications/` — Preferences, routing, templates, and delivery records.
- `integrations/` — Send-only outreach accounts and authorized ATS/feed connections.
- `billing/` — Subscription normalization and entitlements.
- `trust/` — Moderation, source reputation, staleness, and abuse controls.
- `analytics/` — Product event validation and application-efficiency attribution.

No service may read or write another service's tables directly.
