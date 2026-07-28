# Integrations Service

Owns external provider connections, encrypted token references, webhook verification, provider capabilities, and disconnect/revocation workflows.

## Planned subfolders

- `email/` — Send-only Gmail/Outlook connections for approved outreach.
- `ats/` — Employer-authorized ATS/feed connections.
- `oauth/` — Narrow consent, token refresh, revocation, and send-scope checks.
- `webhooks/` — Signature verification, replay protection, and ingestion.
- `providers/` — Provider-specific clients behind stable interfaces.
- `tests/` — OAuth, no-read-scope, webhook, revocation, and provider-failure tests.

Provider tokens never appear in domain events, analytics, or application logs. This service does not read user inboxes/calendars or infer post-submission hiring outcomes.
