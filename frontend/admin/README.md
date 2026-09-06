# Admin Console

The restricted internal console implements the Phase 1 job/source moderation slice and the
default-dark Phase 2 Trust review slice. A protected development preview is deployed; authenticated
human moderation is not accepted. Later customer service, workflow, provider, entitlement,
privacy, and emergency-control surfaces are not implemented or authorized by this application.

## Implemented Phase 1 moderation slice

- `app/` — A responsive, non-indexable moderation console plus narrow same-origin BFF routes.
- `lib/auth0.ts` — A dedicated server-held Auth0 session with an explicit server-only authorization
  profile. The default `standard` profile preserves the moderator/reviewer scope request; `appeals`
  requests only `openid profile trust:review trust:appeal:resolve`. Both require an MFA `amr`,
  reauthentication after 15 minutes, and a one-hour absolute session. Neither requests offline
  access or the separate verified-requester takedown scope. Requested scopes do not assign roles.
- `proxy.ts` — Awaits the SDK callback/session checks and turns rejected callbacks into fixed,
  uncached errors at the configured application origin. Missing MFA still refuses session
  persistence; the login page explains the required proof without exposing provider errors,
  callback parameters, or claims. Other request failures remain fail-closed.
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
- The `standard` profile requests review/open/decide/takedown/appeal scopes but never the separately
  privileged verified-requester takedown scope. The `appeals` profile hides D1 moderation, case
  opening, initial decisions, and takedown controls; it uses only the `appeal_pending` queue and
  evidence-bound uphold/reverse actions. The server remains the authority for every operation.
- Controls use native labels, explicit destructive confirmation, keyboard focus on failures, and an
  `aria-live` result region. The same-origin BFF strictly validates bounded requests and redacted
  responses and emits `no-store` fixed problem details.
- The Gateway and Terraform D2 route inventories are wired. The 2026-09-06 reviewer-binding update
  reached development state `284`, with Gateway/scheduled/Trust versions `52`/`14`/`11`, preserving
  application artifacts from `3f20462`, 18 JWT-protected D2 routes, and the anonymous policy endpoint.
  Before/after access probes, immutable artifact/environment checks, and zero Terraform drift pass.
  The existing workflow case opener is unchanged; a separate delegated M2M identity can read and
  make initial/takedown decisions under the recorded development assignment. Invalid-input probes
  are not completed case decisions or publication evidence.
- This source and its protected preview do not establish human reviewer assignments, authenticated
  admin Auth0 acceptance, accountable policy/timing approval, verified-requester authority, or
  human accessibility acceptance. Human appeal binding and MFA login remain unconfigured; the
  locally implemented appeal-only profile does not activate either.

## Local managed OIDC configuration

Create a dedicated Auth0 Regular Web Application with callback
`http://localhost:3001/auth/callback`, logout/web origin `http://localhost:3001`, and MFA required for
the assigned human reviewer. Select the server-only `ADMIN_AUTHORIZATION_PROFILE` in its local or
hosted environment:

| Profile | Requested OAuth scopes | Presented controls |
|---|---|---|
| `standard` or unset | `openid profile jobs:moderate trust:review trust:case:open trust:case:decide trust:case:takedown trust:appeal:resolve` | Existing moderation and Trust review surface |
| `appeals` | `openid profile trust:review trust:appeal:resolve` | Independent appeal queue, case/evidence reads, uphold/reverse |

Any other value, including an empty string or whitespace, fails closed. A cached standard client
is not reused after selection changes to appeals. Restart and sign out/sign in when configuring a
different profile; this setting does not revoke an existing provider token or change its grants.
Only the exact approved scope/role combination may be granted. The human appeal identity requires
`case_reader` and `appeal_reviewer`, separate from the initial/takedown identity, with the Gateway
independently checking both managed identity and scopes. Do not enable refresh-token grants,
assign verified-requester authority, or reuse candidate-web or M2M credentials. The sole assignment
and rationale record is the [Phase 2 reviewer section](../../docs/product/delivery/phase-2-extension-and-community.md#delegated-reviewer-assignment).

From the repository root, prepare the appeal profile with the local helper (supply the exact tenant,
dedicated admin client, and development API when prompted/configured):

```powershell
.\scripts\configure-auth0-admin-local.ps1 -AuthorizationProfile appeals
```

The helper defaults the API target to local `http://localhost:4000`; pass `-PlatformApiBaseUrl` with
the exact development API origin when testing against AWS. It prompts securely for the dedicated
client secret, generates a fresh session secret, and refuses an existing file unless replacement
is explicitly selected. No credentials or human subjects belong in these instructions. The Auth0
development runbook's historical D1 moderation scopes do not replace the narrower D2 profile.

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
acceptance are established. This preview predates the local appeal-only profile; it includes the
earlier review UI while the matching queue/evidence handlers are deployed in AWS. A fresh protected
admin deployment and exact-host Auth0 configuration are still required for hosted appeal acceptance. Consult the
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
