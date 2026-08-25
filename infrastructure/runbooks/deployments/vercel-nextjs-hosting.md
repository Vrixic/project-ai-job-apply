# Vercel Next.js Hosting

- Status: Source foundation ready; provider session, projects, stable hosts, and deployment pending
- Last updated: 2026-08-25
- Scope: Synthetic development acceptance only

This runbook implements [ADR-026](../../../docs/adr/026-vercel-nextjs-presentation-hosting.md).
It never authorizes real candidate data, public indexing, production launch, or moderation
authority.

## Fixed topology

| Project | Repository root directory | Auth0 application | API permission boundary | Activation posture |
|---|---|---|---|---|
| Candidate web | `frontend/web` | Dedicated candidate Regular Web Application | Candidate scopes; never `jobs:moderate` | Synthetic hosted acceptance after exact-host protection and callback configuration |
| Moderation admin | `frontend/admin` | Dedicated moderation Regular Web Application | Exact `jobs:moderate` only | Identity-dark until D1P disposition, managed grant, MFA moderator, and explicit acceptance authority |

Both source roots contain `vercel.json` with the Next.js framework, monorepo-aware frozen install
and dependency build commands, and single `iad1` Function region. The repository `.vercelignore`
allowlist uploads only the root pnpm/Turbo configuration plus `frontend` and `packages` source,
then re-excludes credentials, dependencies, generated output, caches, mobile, and extension source.
AWS `us-east-2` API Gateway/Lambda remains the server-side target and PostgreSQL remains truth.
Vercel stores no product database or workflow state.

## Local preflight

From a clean repository root, run:

```powershell
git status --short
pnpm --filter @ai-job-apply/web test
pnpm --filter @ai-job-apply/web typecheck
pnpm --filter @ai-job-apply/web build
pnpm --filter @ai-job-apply/admin test
pnpm --filter @ai-job-apply/admin typecheck
pnpm --filter @ai-job-apply/admin build
```

Do not start Docker or WSL for this boundary.

## Provider login and project creation

The operator authenticates interactively. Do not create or paste a long-lived Vercel token into a
shell transcript, chat, source file, or evidence record.

```powershell
pnpm dlx vercel@latest login
$expectedVercelIdentity = Read-Host 'Enter the authorized Vercel username'
$actualVercelIdentity = (& pnpm dlx vercel@latest whoami).Trim()

if ($LASTEXITCODE -ne 0 -or
    [string]::IsNullOrWhiteSpace($expectedVercelIdentity) -or
    $actualVercelIdentity -cne $expectedVercelIdentity.Trim()) {
  pnpm dlx vercel@latest logout
  throw 'The active Vercel identity is not the authorized project owner.'
}
```

Stop before linking, importing, or creating a project when the identity does not exactly match the
account approved for this platform. Logging in successfully is not project authority, and an
existing unrelated account must never be used as a temporary deployment target.

In the Vercel dashboard, import the Git repository twice. Create one project for each root in the
fixed topology table. For both projects:

1. Select the owning root directory exactly.
2. Enable **Include source files outside of the Root Directory in the Build Step** so pnpm workspace
   dependencies and the repository lockfile are available.
3. Keep framework detection on Next.js and do not override the source-owned Function region.
4. Enable Vercel Authentication with Standard Protection before using previews. A generated URL is
   not a secret. Do not put credentials in an unprotected deployment.
5. Leave every Auth0 secret and `PLATFORM_API_BASE_URL` absent for the first build. This proves only
   an identity-dark source build and prevents an import-time deployment from reaching AWS.

Do not link the candidate root and then reuse its `.vercel/project.json` for admin. Local `.vercel`
directories are ignored and never evidence.

## Stable synthetic candidate host

Choose one stable HTTPS hostname that is protected during prelaunch acceptance. Preferred options,
in order:

1. a protected preview branch hostname under Standard Protection; or
2. a production hostname protected with Vercel Authentication for **All Deployments** on a plan
   that supports it.

Do not make the Auth0 development tenant broadly reachable merely to avoid deployment protection.
Do not use an Auth0 wildcard. Record only the selected hostname, never cookies or credentials.

Configure the candidate Auth0 application with these exact entries, replacing `WEB_ORIGIN` with
the selected origin and adding no wildcard:

```text
Allowed Callback URL: WEB_ORIGIN/auth/callback
Allowed Logout URL:   WEB_ORIGIN
Allowed Web Origin:   WEB_ORIGIN
```

The callback path is `/auth/callback` for the repository's Auth0 Next.js SDK v4 boundary; it does
not use the retired `/api/auth/callback` path.

## Candidate environment

Set the following only on the exact protected Vercel target used for synthetic acceptance:

| Variable | Handling | Required value/boundary |
|---|---|---|
| `AUTH0_DOMAIN` | Server-only | Existing development tenant hostname without a scheme |
| `AUTH0_CLIENT_ID` | Server-only | Dedicated candidate web client |
| `AUTH0_CLIENT_SECRET` | Sensitive | Candidate client secret; enter through a secure prompt/dashboard field |
| `AUTH0_SECRET` | Sensitive | Fresh 32-byte hexadecimal session-encryption secret unique to Vercel candidate web |
| `APP_BASE_URL` | Server-only | Exact protected `WEB_ORIGIN`, HTTPS and origin-only |
| `AUTH0_AUDIENCE` | Server-only | Exact `ai-job-apply-api` |
| `PLATFORM_API_BASE_URL` | Server-only | Exact development API Gateway HTTPS origin |
| `PUBLIC_JOB_INDEXING_ENABLED` | Server-only | Exact `false` |

Do not copy local session secrets into Vercel. Do not set any secret or token through a
`NEXT_PUBLIC_*` variable. Keep all other preview targets identity-dark.

After variables change, redeploy the exact target so the immutable deployment receives the new
configuration.

## Admin environment

Do not configure or authenticate the hosted admin merely because its identity-dark build passes.
Before adding any admin credential, all of these must be true:

- the dedicated moderation Regular Web Application exists and is not the candidate client;
- its user-delegated grant is exact `jobs:moderate`, with no candidate/document/profile scopes and
  no refresh-token grant;
- one accountable synthetic moderator has MFA and the tenant policy emits `amr=["mfa"]`;
- the selected stable admin hostname is protected and has exact callback/logout/web-origin entries;
- D1P-01 through D1P-08 have attributable dispositions and the product owner authorizes the bounded
  acceptance run.

Then configure the same server-only variable names as candidate web, using distinct admin client,
client-secret, session-secret, and `APP_BASE_URL` values. Admin has no
`PUBLIC_JOB_INDEXING_ENABLED` variable and emits `X-Robots-Tag: noindex, nofollow, noarchive`.

## Hosted verification

For each activated protected target, retain only the deployment identifier/commit, stable hostname,
timestamps, status/latency aggregates, header names and sanitized values, route/status matrix,
and pass/fail results. Retain no token, cookie, Auth0 subject, email, request/response body,
candidate value, job value, or moderation record.

At minimum verify:

1. the deployment is built from the exact reviewed commit and `iad1` is the Function region;
2. `/` returns the expected application through HTTPS and has HSTS, nosniff, frame denial,
   referrer denial, permissions policy, opener isolation, and the minimum CSP directives;
3. an unknown route is bounded and does not disclose framework/provider internals;
4. an unauthenticated BFF request returns sanitized `401`/`503` with `no-store` as appropriate;
5. candidate login/callback/logout uses the exact Auth0 application and server-held token;
6. the candidate BFF reaches the exact development API Gateway without exposing authorization or
   upstream-private headers;
7. search, saved-job lifecycle, match assessment, reporting, preferences/profile, documents, and
   entitlement behavior are run only within their currently authorized synthetic gates;
8. logs contain no restricted token/secret/candidate values; and
9. Auth0 and AWS exact-window evidence is correlated without retaining identity or payload data.

Admin additionally requires exact `jobs:moderate`, MFA/session enforcement, candidate-scope denial,
response-level crawler denial, and the approved manual-only moderation matrix. A source build or
identity-dark page does not satisfy those gates.

## Failure and rollback

- If a deployment has a wrong root, environment, host, client, scope, region, or headers, remove its
  traffic alias or disable the deployment before diagnosis. Do not broaden Auth0 allowlists.
- Revoke the affected Auth0 client/session secrets if they may have crossed project boundaries.
- Roll back by promoting the last exact accepted deployment only after confirming its environment
  binding. A Vercel rollback never rolls back AWS schemas, API aliases, or durable workflows.
- Remove temporary exact preview URLs from Auth0 after the bounded exercise.
- If no protected stable hostname is available, keep the deployment identity-dark and record
  protected managed-OIDC acceptance as externally blocked.
