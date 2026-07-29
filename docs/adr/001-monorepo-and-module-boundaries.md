# ADR-001: Monorepo and Module Boundaries

Status: Accepted
Date: 2026-07-28

## Context

Web, mobile, extension, services, workers, and adapters share contracts but must retain clear data
ownership and failure boundaries.

## Decision

Use pnpm workspaces and Turborepo. Frontends, backend modules, workers, and packages remain separate
workspaces. Start with a modular core API plus separate workflow, ingestion, AI, and automation
workers. A module owns its schema and exposes contracts; no unrelated module reads its tables.

## Consequences

Contracts and tooling remain synchronized without deploying premature microservices. A module may
split into a deployment when load, security, failure isolation, ownership, or release cadence
requires it.
