# Repository Scripts

Contains reviewed automation for local setup, code generation, validation, fixtures, migrations, and release checks.

## Planned subfolders

- `setup/` — Idempotent developer-environment setup and checks.
- `codegen/` — API, event, database, and client generation.
- `fixtures/` — Sanitization, validation, and fixture maintenance.
- `database/` — Migration, seed, and safe reconciliation helpers.
- `quality/` — Cross-repository lint, test, dependency, and policy checks.
- `release/` — Versioning, artifact, migration, and rollout verification.

Scripts should be non-interactive where practical, support `--help` and dry-run for risky operations, and never embed secrets or production identifiers.
