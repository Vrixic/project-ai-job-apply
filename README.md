# AI Job Search and Application Platform

**ApplyDash** and `applydash.ai` are the provisional presentation identity. The final public brand
may be selected in any later phase; stable technical identifiers remain `ai-job-apply` so that
changing the presentation brand does not require package, database, event, or infrastructure
renames.

This monorepo will contain the candidate-first job discovery and application Platform described in the [product and system architecture](docs/PRODUCT_AND_SYSTEM_ARCHITECTURE.md).

The repository is currently scaffolded at the responsibility-boundary level. Every directory contains a README explaining what it owns, how it fits into the system, and the implementation subfolders expected inside it.

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
a transactional outbox, a Temporal readiness worker, a Next.js foundation page, local containers,
lean `us-east-2` Terraform with isolated development and on-demand staging accounts, and GitHub
CI/security workflows.

```powershell
pnpm install --frozen-lockfile
pnpm contracts:generate
.\scripts\start-local.ps1
pnpm --filter @ai-job-apply/profile-service build
pnpm --filter @ai-job-apply/profile-service db:migrate
pnpm check
```

Auth0 is the selected initial managed identity provider, while the runtime and identity mapping
remain provider-neutral. The deployed application still fails closed until real environment-specific
Auth0 configuration exists and passes conformance; test tokens are unavailable outside
`NODE_ENV=test`.

## Current status

The repository-side foundation, Auth0 web slice, AWS state/OIDC bootstrap, and applications-disabled
development persistent layer are implemented. Phase 0 remains in progress for application
deployment, remaining web identity checks, deployed observability and alert delivery, rollback and
restore evidence, representative permitted ATS fixtures, on-demand staging rehearsal, quality
baselines, and accountable legal/security/privacy approval. Final public naming is a D6 gate, and
mandatory pre-product participant research was removed from D0.

Delivery progress, actual start/completion dates, tasks, evidence, risks, and decisions are maintained in the [delivery tracker](docs/product/delivery/DELIVERY_TRACKER.md).
