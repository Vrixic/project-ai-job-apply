# Admin Console

The restricted internal console supports customer service, job/source moderation, contribution review, workflow diagnosis, provider status, entitlement support, privacy requests, and emergency feature/adapter controls.

## Implemented Phase 1 moderation slice

- `app/` — A responsive, non-indexable moderation console plus narrow same-origin BFF routes.
- `lib/auth0.ts` — A dedicated server-held Auth0 session requesting only `jobs:moderate`.
- `lib/moderation-bff.ts` — Bounded strict request/response validation, token isolation, redirect
  refusal, fixed problem projection, and operator-identity refusal.
- `lib/moderation-bff.test.ts` — Scope/session, strict-input, routing, redaction, and fail-closed
  response coverage.

Admin access is least-privilege and audited. Sensitive values remain redacted, and break-glass actions require a reason and a time-limited grant.

This slice supports fixed-code aggregate report review, open/resolved case queues, explicit job
blocking, exact-source pausing, and no-action resolution. Candidate reports never automatically
change catalog state. Source resume, free-form evidence, automated thresholds, general support,
privacy requests, entitlement support, and break-glass controls are not implemented here. The app
requires a separately configured admin Regular Web Application and is not deployed or accepted
through managed OIDC by these source bytes.
