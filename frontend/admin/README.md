# Admin Console

The restricted internal console implements the Phase 1 job/source moderation slice and the
default-dark Phase 2 Trust review slice. A protected development preview is deployed; authenticated
human moderation is not accepted. Later customer service, workflow, provider, entitlement,
privacy, and emergency-control surfaces are not implemented or authorized by this application.

## Implemented Phase 1 moderation slice

- `app/` — A responsive, non-indexable moderation console plus narrow same-origin BFF routes.
- `lib/auth0.ts` — A dedicated server-held Auth0 session requesting `jobs:moderate` and the explicit
  D2 review/open/decide/takedown/appeal scopes listed below, requiring an MFA `amr`, reauthentication
  after 15 minutes, and a one-hour absolute session. It requests neither offline access nor the
  separate verified-requester takedown scope. Requested scopes do not assign reviewer roles.
- `lib/moderation-bff.ts` — Bounded strict request/response validation, token isolation, redirect
  refusal, fixed problem projection, and operator-identity refusal.
- `lib/moderation-bff.test.ts` — Scope/session, strict-input, routing, redaction, and fail-closed
  response coverage.
- `../../scripts/tests/d1-admin-browser-assurance/` — Installed-Chrome generated-synthetic
  coverage for queue pagination, stale-response fencing, explicit destructive confirmation, exact
  source inputs, private-field non-rendering, focus, and automated WCAG A/AA rules.

Admin access is least-privilege and audited. Sensitive values remain redacted. Break-glass access is
not implemented or authorized by this slice.

## Implemented Phase 2 Trust review

- The console opens and reads redacted Trust cases and records fixed-code, version-fenced initial
  decisions, takedowns, and appeal resolutions with SHA-256 evidence references bound to the
  reviewed content; a digest alone is not readable review evidence.
- The explicit initial-review/appeal queue returns at most 25 cases per page with a bounded opaque
  continuation. Selecting a case loads full sanitized independently verified provider content,
  its source link and verification timestamp. Initial decisions bind the loaded case version and
  digest without manual identifier copying. Missing or version-mismatched readable evidence keeps
  initial decisions disabled; stale responses cannot replace a newer selection. Takedown and appeal
  actions still require separately approved evidence and their exact reviewer authority.
- Ordinary reviewer sessions request review/open/decide/takedown/appeal scopes but never the
  separately privileged verified-requester takedown scope.
- Controls use native labels, explicit destructive confirmation, keyboard focus on failures, and an
  `aria-live` result region. The same-origin BFF strictly validates bounded requests and redacted
  responses and emits `no-store` fixed problem details.
- The Gateway and Terraform D2 route inventories are wired. The completed 2026-09-05 backend
  release, now at state `283`, deploys application source `3f20462` on Gateway version `51` with 18 JWT-protected D2
  routes and the anonymous policy endpoint. The new queue/evidence handlers are deployed after
  migration and worker upgrade/drain; direct boundary and zero Terraform drift checks pass.
- This source and its protected preview do not establish human reviewer assignments, authenticated
  admin Auth0 acceptance, accountable policy/timing approval, verified-requester authority, or
  human accessibility acceptance. Development assigns only the dedicated workflow case opener.

## Local managed OIDC configuration

Create a dedicated Auth0 Regular Web Application with callback
`http://localhost:3001/auth/callback` and MFA required for every assigned synthetic moderator. The
console requests `jobs:moderate`, `trust:review`, `trust:case:open`, `trust:case:decide`,
`trust:case:takedown`, and `trust:appeal:resolve`; grant only the explicitly approved scope/role
combination for each reviewer. Initial/takedown and appeal reviewer assignments remain separate,
and the gateway independently enforces exact managed identities and roles. Do not enable
refresh-token grants, assign the verified-requester scope, or reuse candidate-web credentials.
From the repository root, write the ignored local environment file with:

```powershell
.\scripts\configure-auth0-admin-local.ps1 -Auth0Domain "YOUR_TENANT.us.auth0.com" -ClientId "YOUR_DEDICATED_MODERATION_CLIENT_ID" -PlatformApiBaseUrl "https://YOUR_API_ID.execute-api.us-east-2.amazonaws.com"
```

The command prompts securely for the dedicated client secret and does not print it. The complete
tenant setup and acceptance procedure is in `../../docs/security/auth0-development-runbook.md`.

This slice supports fixed-code aggregate report review, open/resolved case queues, explicit job
blocking, exact-source pausing, and no-action resolution. Candidate reports never automatically
change catalog state. Source resume, free-form evidence, automated thresholds, general support,
privacy requests, entitlement support, and break-glass controls are not implemented here. The app
requires a separately configured admin Regular Web Application. The preview deployment below does
not establish an accepted managed-OIDC moderation session.

## Vercel hosting boundary

The 2026-09-05 preview built from source `116b272` is `READY`:
[protected admin preview](https://ai-job-apply-admin-6ewxee4ci-applydash2026-5637.vercel.app).
Its unauthenticated root returns a Vercel SSO protection redirect (`302`, `no-store`), not the admin
application or proof of an Auth0 reviewer session. No human reviewer roles or hosted admin Auth0
acceptance are established. The preview includes the new review UI, unchanged in the completed
`3f20462` backend release; the matching queue/evidence handlers are now deployed. Consult the
[Phase 2 register](../../docs/product/delivery/phase-2-extension-and-community.md) before attempting
the authenticated end-to-end review journey.

[ADR-026](../../docs/adr/026-vercel-nextjs-presentation-hosting.md) assigns this directory its own
Vercel project, isolated from candidate web. The source configuration runs Functions in `iad1` and
adds minimum browser security headers plus response-level crawler denial. An identity-dark build is
permitted, but no admin credential or managed-OIDC activation is authorized until the separate
client/grant, MFA moderator, protected stable hostname, and D1P dispositions pass. Follow the
[Vercel hosting runbook](../../infrastructure/runbooks/deployments/vercel-nextjs-hosting.md).
`AUTH0_DOMAIN` accepts only the exact lowercase issuer hostname, while `APP_BASE_URL` accepts only
an exact origin with no credentials, path, query, fragment, trailing slash, or trailing-dot host;
HTTP remains limited to local `localhost` or `127.0.0.1` development.
