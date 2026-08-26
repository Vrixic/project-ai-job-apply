# D1 provider-failure deployable foundation — 2026-08-26

## Scope and outcome

Exact implementation revision `29d3ab0de6e65d4c6b66213e83c15824350cd1a8` completes the
repository-controlled path for one generated-synthetic provider failure and recovery exercise:

- the existing ingestion durable and activity artifacts discriminate a strict operator-only
  fixture input, inject exactly one `source_unavailable` retry, wait one durable second, and recover
  to an empty success without provider traffic, database access, catalog writes, or scheduler
  registration;
- a dedicated local publisher immutably publishes and exact-version verifies only the two
  ingestion artifact sets under `lambda/ingestion`;
- a checksum-gated dark-release operator limits Terraform to the exact ingestion artifact-caused
  change inventory and verifies numeric unweighted versions, durable/activity cross-binding,
  disabled schedules and mapping, empty queues, absent NAT, idle ECS, and fresh zero drift; and
- a separate one-run acceptance operator binds the exact source, reviewed representative config,
  numeric versions, encrypted Terraform state, pre- and post-run refresh-backed zero drift, private
  durable result, aggregate-only evidence, cleanup, and resumable receipt.

The representative assessor validates provider-failure evidence independently from alert delivery.
It remains fail-closed until accountable latency/error/queue thresholds and an exact recipient-set
binding exist.

## Verification

- Workflow tests: `70/70` across 10 files.
- Workflow typecheck and build: pass.
- Full infrastructure validation, including the publisher, dark-release, provider-failure,
  representative, deployment, restore, and catalog-invariant suites: pass.
- Publisher, dark-release, provider-failure, and representative tests: pass in PowerShell 7 and
  Windows PowerShell 5.1.
- Scoped Biome checks, dependency audit, staged secret-pattern scan, and `git diff --check`: pass.
- Docker Desktop and WSL were not started.

## Safety and non-claims

- No AWS, Terraform, provider, database, Vercel, Auth0, candidate-data, Docker, or WSL mutation was
  performed by this source packet.
- The fixture is not in the scheduled source list and grants no provider or trigger authority.
- Source verification is not deployed execution. Immutable publication, reviewed default-dark
  deployment, and the one-run acceptance remain the next autonomous steps.
- Alert delivery still requires an attributable human recipient confirmation; representative
  thresholds and recipients must not be invented.
- Phase 1 remains in progress behind those execution inputs, Vercel, and accountable accessibility,
  security/privacy, moderation, source-quality, product, resume-trigger, and candidate-rights gates.
