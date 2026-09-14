# Admin Console

The restricted internal console implements the Phase 1 job/source moderation slice and the
default-dark Phase 2 Trust review slice. A protected development preview is deployed, and the
separate human appeal identity and local empty-queue read are accepted in development. Three
delegated initial decisions pass under D2-042; hosted reviewer, actual takedown and human appeal
journeys remain open. Later customer service, workflow, provider, entitlement,
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
- Local decision drafts are case/version/purpose-scoped. Changing queues or loading a case clears
  manual evidence and confirmation; editing evidence requires a new takedown confirmation. Late
  reads cannot restore an obsolete selection, and repeated clicks cannot duplicate an in-flight
  write. An acknowledged write with unavailable follow-up evidence explicitly requests a reload;
  ambiguous writes are never automatically replayed. These D2-054 changes are deployed in the
  protected identity-dark preview below; hosted sign-in and human decision acceptance remain open.
- The Gateway and Terraform D2 route inventories are deployed. The verified 2026-09-08 development
  rollout preserves all three reviewer assignments: workflow case opener, separate delegated M2M
  read/initial/takedown reviewer, and separate human read/appeal reviewer. Exact runtime readback
  and zero Terraform drift pass. See the [Phase 2 register](../../docs/product/delivery/phase-2-extension-and-community.md)
  for the exact release evidence rather than treating a presentation build as backend deployment.
- The human identity/MFA/scope check and separate backend appeal binding pass; the user confirms
  a successful empty local appeal-queue read. The appeal-only profile does not itself assign
  permissions. D2-042 subsequently records three evidence-bound delegated initial decisions with
  accepted/version-2 readbacks, not human appeal or hosted-console acceptance. Hosted admin Auth0,
  actual takedown and human appeal journeys, verified-requester
  authority, human accessibility acceptance, and accountable production approval remain open.
  Invalid-input probes and an empty queue are not completed case decisions or publication evidence.

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

## Local appeal identity verification

During a separately authorized local setup window, **Verify reviewer setup** compares the
SDK-validated MFA session and independently verified RS256 access token with the expected human
identity, dedicated client, issuer, audience, and two appeal/read scopes. The check is a same-origin
server action, not a public Gateway endpoint. It makes no role, case, grant, or refresh request.

It is absent by default and requires the `appeals` profile, exact `http://localhost:3001` origin,
no Vercel environment, and valid process-only `ADMIN_APPEAL_SETUP_CONFIG` for a window no longer
than two hours. The local launcher supplies its schema/version, expected identity and client,
run identifier, exact timestamps, and exclusive-create result path under the repository's
current-user-only `.tmp/d2-reviewer` directory. Never place this configuration in source,
`.env.local`, Vercel, or browser props, and never paste a token or human subject into chat.

The result file contains only verification aggregates and a private one-way identity-binding
fingerprint; existing files and filesystem links are refused. Keep it in the private ignored setup
directory, not shared evidence. The browser receives only a fixed result status. Successful
verification does not deploy roles, load cases, renew contribution policy, or establish hosted
acceptance. The sole assignment and rationale record remains the
[Phase 2 reviewer section](../../docs/product/delivery/phase-2-extension-and-community.md#delegated-reviewer-assignment).

## Vercel hosting boundary

On 2026-09-14 the owner confirms the exact hosted Auth0 callback/logout/web-origin entries and
separately approves reusing the saved dedicated client secret only for protected development,
with deployment-only variables and a fresh hosted session secret. All 174 admin tests, typecheck,
production build and exact Vercel preflight pass. The owner clarifies that the reported
`503 identity_unavailable` came from the selected stable host's `/auth/callback`, still routed
to its older identity-dark deployment, not the generated preview. That first preview separately
had no application keys in its runtime inventory. The proxy dynamically
checks required environment settings; no hardcoded identity-dark value or Next configuration
inlining is present. All 31 targeted Auth0/proxy tests pass without application code changes.

One corrected preview from source `211e59de51c6ea46fe1d9536bf8b0b4c7bc213fe` is READY as
deployment `dpl_GwzQxabzVjM4rMgwXejddZWAHwE7`:
[corrected protected admin preview](https://ai-job-apply-admin-1apsg6bq6-applydash2026-5637.vercel.app).
Paired deployment-only `--env` and `--build-env` overrides provide the same eight server-only
application settings to the Vercel runtime and builder. Both key inventories now contain all
eight names; project-wide environment keys remain zero. The Vercel builder receives the private
settings, but none is added to Turbo cache hashes, public configuration or browser variables.
A fresh hosted session secret is used; the original encrypted local setup is unchanged.
Protection and application source are unchanged. Key presence and READY are deployment evidence,
not proof of an accepted human Auth0 session, MFA, queue read or logout.

Only the selected protected stable alias
[hosted appeals](https://ai-job-apply-admin-applydash2026-5637.vercel.app) now targets the corrected
deployment. Independent deployment readback `ede5cf` verifies both eight-key inventories; final
alias readback `b5964c` confirms the exact binding and Vercel `302` / `no-store` protection.
The shorter `https://ai-job-apply-admin.vercel.app` remains unchanged on
`dpl_H4CZQ4X4YrHunG92Sh7HaUZFDpLD` and unselected; project environment keys remain zero.

Next, start a fresh journey from the protected stable root using ordinary Vercel access. Select
**Sign in as appeal reviewer**, complete MFA, then **Load review queue** and report the
active/empty-queue result or fixed error. Do not refresh the earlier callback or reuse its
authorization code. Check logout only after the session is accepted. Deployment and alias
verification created no human Auth0 session and performed zero case actions; those acceptance
checks remain open. Do not create a protection-bypass secret or infer case-decision authority
from them. No repeated secret-reuse approval, new role, paid protection upgrade or branch is needed.
The [single Phase 2 decisions record](../../docs/product/delivery/phase-2-extension-and-community.md#decisions-and-scope-changes)
owns the scope and rationale; hosted sign-in and appeal acceptance remain open.

Historical hosting evidence:

The first September 14 preview from `ea56284a5da5edf8baceb6b02ad2465d05185377`, deployment
`dpl_9e3nKf7VWPNDrdJMekJuEfNVeLUG`, reached READY in `iad1` on Node 24:
[initial preview](https://ai-job-apply-admin-nfsm531uo-applydash2026-5637.vercel.app).
All eight application keys were absent from its runtime inventory, while the existing working
candidate deployment listed its custom keys. The preview and selected stable alias returned
Vercel `302` / `no-store`, but that proved protection, not application configuration. Both stable
aliases still targeted `dpl_H4CZQ4X4YrHunG92Sh7HaUZFDpLD` at that checkpoint. The owner's later
URL clarification locates the `503 identity_unavailable` response at that old stable callback,
not this generated preview. The corrected preview and exact protected-alias move above supersede
the old inspection request. Neither the missing-key finding nor the callback failure changed a
reviewer role or established hosted acceptance.

The protected identity-dark preview from `b3da818` (2026-09-11):
[admin preview](https://ai-job-apply-admin-5lytaj3kw-applydash2026-5637.vercel.app).
Exact source/project readback, `iad1`/Node 24 and three Vercel-protected `302`/`no-store` checks
pass after 174 admin tests and typecheck. It includes the appeal profile and D2-054 reviewer-state
fixes. The existing project has no configured environment variables; hosted Auth0 still requires
one protected stable origin, exact callback/logout configuration, the dedicated human appeal
client and server-only `appeals` profile settings. No new role, grant or hosted session is implied.

The 2026-09-05 preview built from source `116b272` is `READY`:
[protected admin preview](https://ai-job-apply-admin-6ewxee4ci-applydash2026-5637.vercel.app).
Its recorded unauthenticated root returns a Vercel SSO protection redirect (`302`, `no-store`), not
the admin application or proof of an Auth0 reviewer session. Human appeal/read roles were later
bound and local access accepted, but hosted admin Auth0 acceptance remains open. This preview
predates the local appeal-only profile; it includes the
earlier review UI while the matching queue/evidence handlers are deployed in AWS. The fresh protected
admin deployment above supersedes this older presentation; exact-host Auth0 configuration and
hosted appeal acceptance remain. Consult the
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
