# AI Job Search and Application Platform

**ApplyDash** and `applydash.ai` are the provisional presentation identity. The final public brand
may be selected in any later phase; stable technical identifiers remain `ai-job-apply` so that
changing the presentation brand does not require package, database, event, or infrastructure
renames.

This monorepo will contain the candidate-first job discovery and application Platform described in the [product and system architecture](docs/PRODUCT_AND_SYSTEM_ARCHITECTURE.md).

The repository contains implemented web, extension, API, persistence, and workflow boundaries.
Boundary READMEs explain ownership; the delivery tracker distinguishes local implementation,
controlled development deployment, and remaining release acceptance.

## Repository map

- `frontend/` — Web, mobile, browser extension, and internal admin clients.
- `backend/` — API gateway, domain services, durable workflows, and isolated workers.
- `packages/` — Shared contracts, SDKs, validation, design, auth, and observability.
- `data/` — Versioned taxonomies, evaluation sets, and synthetic development seeds.
- `infrastructure/` — Cloud resources, deployments, observability, and runbooks.
- `docs/` — Architecture, product requirements, ADRs, and security/privacy design.
- `scripts/` — Setup, code generation, fixtures, quality, database, and release tooling.
- `skills/` — Repository-local agent skills for onboarding, development, operation, deployment,
  and delivery governance.
- `.github/` — Repository automation and CI/CD workflows.

Repository-aware coding agents should begin with [`AGENTS.md`](AGENTS.md), which routes common
requests to the focused skills in [`skills/`](skills/README.md).

## Architecture principles

1. Optimize for rapid, relevant, truthful, and confirmed applications—not downstream hiring outcomes.
2. Keep candidate facts grounded, review sensitive or uncertain answers, and bind submission approval to an immutable packet.
3. Separate the durable control plane from unreliable external work.
4. Give every service clear data ownership; communicate through versioned contracts and events.
5. Isolate ATS adapters and provider workers so one failure does not disable the product.
6. Prefer quality, simplicity, robustness, scalability, and long-term maintainability over predicted development speed or cost.
7. Collect the minimum user data necessary and never place production PII in source, fixtures, logs, or analytics.

## Working conventions

- Frontends consume generated API clients and never import backend implementations.
- Backend modules do not access another module's tables directly.
- Shared packages remain narrowly scoped and free of product-service persistence.
- Long-running or external operations use durable workflows and idempotent workers.
- Every ATS adapter includes sanitized fixtures, capability declarations, telemetry, regression tests, and a kill switch.
- Infrastructure and operational changes are versioned and reviewed like application code.
- Empty implementation subfolders should be created when work begins rather than maintained solely as placeholders.

## Phase 0 runtime

The repository now contains a pinned pnpm/Turborepo workspace, OpenAPI and event contracts,
provider-neutral OIDC verification, a modular NestJS/Fastify API, Drizzle/PostgreSQL persistence,
a transactional outbox, SQS-backed Lambda durable readiness execution, a Next.js foundation page,
local dependency containers, lean `us-east-2` Terraform with isolated development and synthetic
staging accounts, and GitHub CI/security workflows.

```powershell
pnpm install --frozen-lockfile
pnpm contracts:generate
.\scripts\start-local.ps1
pnpm --filter @ai-job-apply/profile-service build
pnpm --filter @ai-job-apply/profile-service db:migrate
pnpm check
```

`pnpm test` runs package tasks one at a time; each suite retains its internal worker scheduling.
This prevents simultaneous large test pools from contending for the workstation without relaxing
runtime deadlines or test assertions. `pnpm test --force` bypasses cached task results.

Auth0 is the selected initial managed identity provider, while identity mapping remains
provider-neutral. Deployed APIs fail closed unless the exact environment issuer, audience, and
scopes validate; test tokens are unavailable outside `NODE_ENV=test`.

## Current status

Phase 2's extension and community backend support controlled Greenhouse, global-Lever and hosted
Ashby development contributions. The [description release checkpoint](docs/product/delivery/phase-2-extension-and-community.md#d2-060--plaintext-description-compatibility)
records source `dccbb65`, state `338`, Gateway/scheduled/Trust versions `66`/`26`/`20` and zero
meaningful Terraform changes. Existing Greenhouse and Supermove/global-Lever registrations are
preserved; only the supplied hosted Ashby board is added. The four allowed hosts are the two
Greenhouse hosts, `jobs.lever.co` and `jobs.ashbyhq.com`. EU Lever, custom-domain detection,
production and store distribution remain disabled. D2-R22's acquisition/source-binding/deployment
blocker is closed; installed Ashby preview/delivery/Trust/publication acceptance remains under
D2-035 and is not implied by activation. The user confirms description availability but reports
its 12,000-character cutoff. [D2-061](docs/product/delivery/phase-2-extension-and-community.md#d2-061--complete-description-capture)
implements complete capture within the existing 50,000-character limit and explicit refusal of
oversized text or encoded requests. The actual supplied-page read-only check preserves all
18,185 characters; compatible verifier deployment and installed full-description acceptance remain separate.
The user now reports Processing `published` and Trust `accepted` for the reviewed Lever
contribution; its website visibility/details/source journey is not yet confirmed. General
provider ingestion remains dark, separate from D2 independent verification. Phase 2 is still
In progress.

The 2026-09-08 rollout introduced persistent opt-in development contributions without signing,
remote policy fetching, expiry, or renewal. Authentication, exact client/provider/host scope,
independent provider verification, and Trust review remain enforced. The historical `42b9686`
release applied Jobs `0022`, verifying 42 migrations and 68 relations across six migration owners
and ten schemas at state 290, with Gateway/scheduled/Trust versions 55/17/13. The dependency and
packaging repairs are complete (D2-034/D2-037).

The September 10 coordinated development checkpoint used source
`2dd3aa21d2991bc97caebc3e90e785654eb9fb1e`; the Phase 2 register owns subsequent release updates.
Its revision-51 migration ran exactly once on 2026-09-10 with exit `0` and seven exact aggregate
success messages, verifying 44 migrations, 68 relations, six migration owners and ten schemas,
including Jobs `0023` and Trust `0004`. After the maintenance retirement window, Resume Apply
advanced state 295 to 296 at `00:50:58Z`; maintained Verify and the `01:09:09Z` readback confirm
Gateway/scheduled/Trust versions 58/20/16, reservations 2/1/2, resumed D2 handlers and triggers,
and a non-applyable plan with zero resource or output changes. No ECS compute remains active.

The user confirms reloading the rebuilt development extension, signing in, and adding a job
successfully on 2026-09-08, completing D2-033 and closing D2-R11. This is user-confirmed installed
acceptance, not provider verification, Trust acceptance, website publication, or the full browser
lifecycle. Refresh existing acknowledged contributions' Processing/Trust state rather than resubmit;
the prior processing snapshot is not a current owner-state observation.

All three reviewer assignments are bound: the workflow is case-opener-only, the distinct delegated
agent retains Greenhouse initial/takedown and approved global-Lever initial review, and the separate
human can read and resolve appeals. Ashby activation changes no reviewer authority and includes no
Ashby Trust decision. Exact human identity/MFA/scope checks and the user-confirmed empty local
appeal-queue read pass. D2-042's September 10 shared-client SQL fix supersedes the earlier rolled-back `503`:
three evidence-bound initial decisions have accepted/version-2 readbacks. Subsequent aggregates
record three processing completions and three copied Trust signals. These aggregates do not
establish each owner's website publication. Hosted reviewer, actual takedown, and separate human
appeal journeys remain open; the existing assignments and their separation are unchanged.

The rights/export activity and dark-ingestion releases are verified. Gateway `423d63b` and
corrected core `2ff32ef`/version `14` include the later deletion-retry fixes. On September 11,
D2-038/050/052/053 complete the bounded current-schema recovery on the same 44-migration,
68-relation PITR copy: one historical already-reconciled subject, no new reconciliation or document
writes. The temporary executor, restored copy and drill-only permissions are removed, with
Platform `329`/Bootstrap `21` zero drift; protected evidence remains retained. Do not repeat the
completed drill or mistake restored-only replay for fresh candidate export/deletion acceptance.
Owner readback, provider fixtures, human/browser testing and the other recorded acceptance gates
remain. The isolated replay executor remains default-off. The D2-039/041 contract delta did not
require an additional hosted web/admin bundle; later frontend changes need their own rollout.
The old singleton Jobs verification writer cannot run against `0023`; rollback must keep
contributions disabled or use a compatible binary. This is not Phase 2 completion.

The [admin hosting boundary](frontend/admin/README.md#vercel-hosting-boundary) records the earlier
protected presentation preview, not hosted Auth0 moderation acceptance. Other provider activation,
production/store distribution, and final accountable acceptance remain separate gates.

D2-054 additionally repairs client-only session/queue races and stale reviewer decision drafts.
The complete extension and admin unit suites pass locally. Reload the rebuilt unpacked extension
to use its fix; the admin presentation needs its own rollout. These changes grant no additional
provider, reviewer or publication authority.

The following Phase 0/1 overview is historical; use the linked delivery records for the current
status of each individual gate.

The repository foundation, Auth0 web slice, isolated AWS environments, scale-to-zero Lambda
application runtime, durable workflow path, restore operators, observability, and provider
retirement are implemented and deployed in development and synthetic staging. Phase 0 completed on
2026-08-12 after its evidence-based final acceptance. Phase 1 remains in progress, but its core
backend is substantially deployed: managed identity and canonical catalog are complete; profile,
document, search, saved-job, conservative matching, reporting/moderation, entitlement, provider
ingestion, and isolated public-job foundations are implemented; fixed managed-OIDC read,
saved-job, and match workloads pass; and both S3 version recovery and an isolated PostgreSQL
point-in-time recovery pass with complete cleanup. Document triggers, ingestion schedules, provider
egress, the public API route, indexing, and real-candidate use remain disabled.

The remaining Phase 1 gates are intentionally fail-closed: Vercel candidate/admin deployment and
hosted browser/header evidence; exact public-route load/abuse acceptance; dedicated admin identity
and moderation authority; accountable source, document-trigger, security/privacy/accessibility,
and product decisions; representative SLO acceptance; and approved candidate export/deletion and
retention behavior. Under [ADR-024](docs/adr/024-application-history-and-inbox-phase-ownership.md),
authoritative technical application history belongs to D3 rather than D1. Final public naming and
the independent launch review remain D6 gates.

Delivery progress, actual start/completion dates, tasks, evidence, risks, and decisions are maintained in the [delivery tracker](docs/product/delivery/DELIVERY_TRACKER.md).
