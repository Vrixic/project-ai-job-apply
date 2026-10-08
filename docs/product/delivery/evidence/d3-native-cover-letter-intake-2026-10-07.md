# Native cover-letter Gateway intake — 2026-10-07

The local Gateway and Lambda entry points now compose explicit cover-letter Prepare through
owner context reads into the existing atomic preparation/outbox. This closes the missing intake
composition. It does not complete D3 or activate a deployment.

## Implementation

- A pure AI SDK context subpath preserves generation's exact confirmed-fact selection and full
  posting hashes. The Gateway imports no model generation or provider implementation from it.
- Applications holds the existing Identity active-candidate lease while the Gateway reads Profile
  and Jobs through their owning APIs on separate pools. It reads application metadata only and
  holds no application row lock over the other owner reads. Acceptance rechecks revision and
  active candidate in the existing queue transaction.
- Context fails on disabled/withdrawn intake, unavailable or expired jobs, invalid/regressing
  time, and unavailable owners. Restricted facts are excluded. Only hashes reach preparation.
- An original idempotent retry returns its existing operation without refreshing consent or
  consulting volatile context. Status and receipts remain available after intake withdrawal.
- Both entry points use the default-off `NATIVE_COVER_LETTER_PREPARATION_ENABLED` flag with
  packet protection, native read authorization and native cover-letter location prerequisites.
  Development/staging Terraform expose the same default-off setting. No IAM grants were added.

## Local evidence

Working tree based on `1a2d2f54`, Windows Node 24 / pnpm 10, disposable PostgreSQL 16.14.
Synthetic auth, packet crypto and job fixture; real Profile/Applications database and HTTP handler.
No browser, live OIDC, provider call, AWS deployment or generated-document availability claim.

- Gateway dependency build and Gateway typecheck passed.
- Pure context bundle inspection: 102 input modules, zero model-generation/provider imports.
- 28 real PostgreSQL integration cases passed, including HTTP 202 acceptance, exact stored hashes,
  replay after withdrawal with exactly one outbox event, and four native refusal cases.
- AI SDK: 293 tests passed, including existing context selection/hash regressions.
- Applications: 396 unit tests passed.
- Terraform platform native-material configuration: nine tests passed with mocked AWS.

Repository-wide `scripts/verify-phase0.ps1` is running; its result is not yet claimed.
The disposable SQL container was removed and Docker Desktop/WSL stopped after SQL checks.

## Remaining work

The production Gateway still lacks the live temporary-material availability port needed for
approval. Native location metadata cannot substitute for that check. Complete scalar live
availability and its authentication/transport composition, then exercise Prepare through native
review and approval. Managed runtime, client and authorized ATS acceptance remain outstanding.
D1 and D3 stay In progress. Hosted CI/CD remains deferred; the PC stays on.
