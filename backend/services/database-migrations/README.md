# Database Migration Orchestrator

Runs each service-owned PostgreSQL migration executable in an explicit order inside the retained
one-off migration container. It composes ownership boundaries without allowing one service to edit
another service's tables.

## Subfolders

- `src/` — Fail-fast process orchestration, CLI entry point, and unit tests.

Adding a schema owner requires adding its independently checksum-verified runner here, including it
in `Dockerfile.migration`, and updating restore verification. The container remains a bounded
Fargate task and is never an always-on service.
