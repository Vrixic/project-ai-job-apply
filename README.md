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

Auth0 is the selected initial managed identity provider, while identity mapping remains
provider-neutral. Deployed APIs fail closed unless the exact environment issuer, audience, and
scopes validate; test tokens are unavailable outside `NODE_ENV=test`.

## Current status

Phase 2's extension and community backend are implemented in controlled Greenhouse-only
development, with remaining rollout and acceptance tracked in the
[Phase 2 register](docs/product/delivery/phase-2-extension-and-community.md). The follow-up adds
warm-policy refresh, exact page/provider description compatibility, pre-verification owner
cancellation, reviewer queue/evidence, and complete Trust decision reconciliation. The ordered
backend rollout completed on 2026-09-05: development state `281` runs source `3f20462` on healthy
immutable Gateway/scheduled/Trust versions `51`/`13`/`11`, with 18 exact JWT-protected D2 routes plus
the anonymous signed-policy endpoint. The migration image from `116b272` completed once with exit
`0` and seven exact aggregate success events, verifying 40 migrations across six owners and 68
relations; operator recovery did not rerun it. Direct Gateway boundary checks and zero Terraform
drift pass. Historical point-in-time restore evidence still covers the prior 39-migration boundary.
The configured extension is rebuilt; reload the unpacked extension and complete installed
acceptance. Snapshot-fenced recovery cleared both provider-verification holds, but both submissions
remain parked and unpublished; refresh their existing Processing/Trust state rather than resubmit.

The admin preview from source `116b` is `READY` behind Vercel SSO protection (`302`, `no-store`);
see the [admin hosting boundary](frontend/admin/README.md#vercel-hosting-boundary). This is a
presentation deployment, not authenticated moderation acceptance: human reviewer roles and hosted
admin Auth0 acceptance remain open. Production/store distribution, other provider activation, and
accountable acceptance are not implied by a build, a route resource, or a protected preview.

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
