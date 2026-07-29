---
name: repo-onboarding
description: Orient contributors and answer repository-navigation or current-capability questions for the AI job application platform. Use when someone is new to the repository, asks how the system fits together, wants to find the owner or correct folder for work, needs a contribution starting point, or asks whether a capability is implemented, planned, deployed, or blocked.
---

# Repository Onboarding

## Establish current truth

1. Read `../../README.md`.
2. Read the repository map and the relevant product section in
   `../../docs/PRODUCT_AND_SYSTEM_ARCHITECTURE.md`.
3. Read `../../docs/product/delivery/DELIVERY_TRACKER.md` and the current phase document before
   describing status.
4. Read the README of every folder directly involved in the question.
5. Inspect implementation and tests when the question asks what actually works.

Never infer implementation from a planned folder or architecture paragraph. Label statements as
implemented, locally verified, deployed, planned, or externally blocked.

## Explain the repository

- `frontend/`: web, limited mobile, extension, and admin clients.
- `backend/gateway/`: authenticated synchronous API boundary.
- `backend/services/`: domain ownership and persistence.
- `backend/workflows/`: durable orchestration; keep external I/O in activities/workers.
- `backend/workers/`: isolated unreliable or provider-specific work.
- `packages/`: shared contracts and infrastructure-free primitives.
- `data/`: versioned taxonomies, evaluations, and synthetic seeds.
- `infrastructure/`: Terraform, observability, deployment artifacts, and runbooks.
- `docs/`: architecture, decisions, security, product evidence, and delivery state.

Preserve ownership rules: clients use generated contracts, modules do not access another owner's
tables, and shared packages do not become a dumping ground for service logic.

## Route the next task

- Use `operate-local-platform` for machine setup, commands, failures, and local verification.
- Use `guard-product-architecture` for design, product boundary, security, or privacy questions.
- Use `evolve-platform-contracts` for transport, event, entity, taxonomy, or migration changes.
- Use `build-vertical-slice` for feature implementation.
- Use `deploy-aws-platform` for cloud status or deployment work.
- Use `govern-delivery` for phase status or tracker changes.

When onboarding, give the shortest useful path: prerequisites, the relevant folder, one source of
truth, one verification command, and known blockers. Do not overwhelm a contributor with the
entire future architecture.

## Preserve product scope

The platform accelerates truthful, tailored applications through confirmed submission. It does
not provide coaching or collect post-submission hiring outcomes. Call out requests that conflict
with this boundary instead of quietly extending scope.
