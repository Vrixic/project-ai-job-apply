# Admin Console

The restricted internal console supports the Phase 1 job/source moderation slice and a source-only,
default-dark Phase 2 Trust review slice. Later customer service, workflow, provider, entitlement,
privacy, and emergency-control surfaces are not implemented or authorized by this application.

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

## Source-only Phase 2 Trust review

- The console opens and reads redacted Trust cases and records fixed-code, version-fenced initial
  decisions, takedowns, and appeal resolutions using SHA-256 evidence references only.
- Ordinary reviewer sessions request review/open/decide/takedown/appeal scopes but never the
  separately privileged verified-requester takedown scope.
- Controls use native labels, explicit destructive confirmation, keyboard focus on failures, and an
  `aria-live` result region. The same-origin BFF strictly validates bounded requests and redacted
  responses and emits `no-store` fixed problem details.
- This source does not establish live reviewer assignments, policy/timing approval, verified-
  requester authority, deployment, or accessibility acceptance. Gateway Lambda routing remains
  default-dark.

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

## Vercel hosting boundary

[ADR-026](../../docs/adr/026-vercel-nextjs-presentation-hosting.md) assigns this directory its own
Vercel project, isolated from candidate web. The source configuration runs Functions in `iad1` and
adds minimum browser security headers plus response-level crawler denial. An identity-dark build is
permitted, but no admin credential or managed-OIDC activation is authorized until the separate
client/grant, MFA moderator, protected stable hostname, and D1P dispositions pass. Follow the
[Vercel hosting runbook](../../infrastructure/runbooks/deployments/vercel-nextjs-hosting.md).
`AUTH0_DOMAIN` accepts only the exact lowercase issuer hostname, while `APP_BASE_URL` accepts only
an exact origin with no credentials, path, query, fragment, trailing slash, or trailing-dot host;
HTTP remains limited to local `localhost` or `127.0.0.1` development.
