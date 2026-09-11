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

`D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON` optionally selects up to three unique exact names
from `greenhouse`, `lever`, and `ashby`. It is a JSON array, not a comma-separated string; an
explicit empty array denies every provider. Absence preserves the existing Greenhouse-only
development selection. Any presence outside explicit development mode is invalid, including
empty text or an empty array. `loadD2DevelopmentContributionProviders` returns a frozen selection
and is shared by Gateway and scheduled processing so their interpretation cannot diverge. This
selection neither activates routes nor supplies provider-verification registrations.

`D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON` adds an independent exact-host restriction: an optional
JSON array containing only unique values from `boards.greenhouse.io`, `job-boards.greenhouse.io`,
`jobs.lever.co`, `jobs.eu.lever.co`, and `jobs.ashbyhq.com`. Absence preserves the selected providers'
existing descriptor domains; `[]` denies every domain. JSON `null`, duplicates, suffixes, URLs,
wildcards, case changes and any presence outside explicit enabled development mode are rejected.
`loadD2DevelopmentContributionDomains` returns `undefined` or a frozen selection and rereads current
configuration on every call. Selecting the global Lever host does not select its EU host. This
narrowing control does not enable a provider, route or verifier, or change immutable lease descriptors.
