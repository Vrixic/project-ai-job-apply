# AI Job Search and Application Platform

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
- `.github/` — Repository automation and CI/CD workflows.

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

## Current status

Architecture and repository responsibilities are defined. No application runtime, dependency workspace, cloud resources, or deployment configuration has been initialized yet.

Delivery progress, actual start/completion dates, tasks, evidence, risks, and decisions are maintained in the [delivery tracker](docs/product/delivery/DELIVERY_TRACKER.md).
