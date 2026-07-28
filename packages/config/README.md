# Typed Configuration

Defines typed, validated, environment-aware configuration shared by applications, services, workers, and tooling.

## Planned subfolders

- `schema/` — Configuration definitions and validation.
- `environments/` — Non-secret environment defaults.
- `features/` — Feature flag keys and metadata.
- `providers/` — Provider configuration shapes.
- `loaders/` — Runtime-specific loading adapters.
- `testing/` — Safe deterministic test configuration.

Secrets are references loaded from a secrets manager and must never be committed here.
