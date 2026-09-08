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

## Presentation brand

`src/brand.ts` owns the provisional presentation identity and its override contract. ApplyDash and
`applydash.ai` are defaults, not approved public or network identities. New clients must resolve
presentation branding through this contract while keeping origins, email, OAuth, packages,
databases, and infrastructure identifiers separate.

## Development contributions

`D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED` is an exact boolean string, defaults to `false`, and
requires `D2_DEPLOYMENT_ENVIRONMENT=development` when enabled. This explicit development mode
does not require signed contribution-policy inputs. It does not enable routes or processing by
itself, remove Profile consent or Trust configuration, or relax production/default policy expiry.
The legacy public signed-policy route still requires its signed envelope and public-key map.
