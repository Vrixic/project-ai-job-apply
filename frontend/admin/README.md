# Admin Console

The restricted internal console currently supports only the Phase 1 job/source moderation slice
described below. Later customer service, contribution, workflow, provider, entitlement, privacy,
and emergency-control surfaces are not implemented or authorized by this application.

## Implemented Phase 1 moderation slice

- `app/` — A responsive, non-indexable moderation console plus narrow same-origin BFF routes.
- `lib/auth0.ts` — A dedicated server-held Auth0 session requesting only `jobs:moderate`, requiring
  an MFA `amr`, reauthentication after 15 minutes, and a one-hour absolute session. It does not
  request offline access.
- `lib/moderation-bff.ts` — Bounded strict request/response validation, token isolation, redirect
  refusal, fixed problem projection, and operator-identity refusal.
- `lib/moderation-bff.test.ts` — Scope/session, strict-input, routing, redaction, and fail-closed
  response coverage.
- `../../scripts/tests/d1-admin-browser-assurance/` — Installed-Chrome generated-synthetic
  coverage for queue pagination, stale-response fencing, explicit destructive confirmation, exact
  source inputs, private-field non-rendering, focus, and automated WCAG A/AA rules.

Admin access is least-privilege and audited. Sensitive values remain redacted. Break-glass access is
not implemented or authorized by this slice.

## Local managed OIDC configuration

Create a dedicated Auth0 Regular Web Application with callback
`http://localhost:3001/auth/callback`, delegated `jobs:moderate` access only, and MFA required for
every assigned synthetic moderator. Do not enable refresh-token grants or reuse candidate-web
credentials. From the repository root, write the ignored local environment file with:

```powershell
.\scripts\configure-auth0-admin-local.ps1 -Auth0Domain "YOUR_TENANT.us.auth0.com" -ClientId "YOUR_DEDICATED_MODERATION_CLIENT_ID" -PlatformApiBaseUrl "https://YOUR_API_ID.execute-api.us-east-2.amazonaws.com"
```

The command prompts securely for the dedicated client secret and does not print it. The complete
tenant setup and acceptance procedure is in `../../docs/security/auth0-development-runbook.md`.

This slice supports fixed-code aggregate report review, open/resolved case queues, explicit job
blocking, exact-source pausing, and no-action resolution. Candidate reports never automatically
change catalog state. Source resume, free-form evidence, automated thresholds, general support,
privacy requests, entitlement support, and break-glass controls are not implemented here. The app
requires a separately configured admin Regular Web Application and is not deployed or accepted
through managed OIDC by these source bytes.
