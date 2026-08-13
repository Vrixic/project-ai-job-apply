# API Contracts

Defines versioned API schemas and generates type-safe clients for web, mobile, extension, admin, gateway, and services.

## Planned subfolders

- `openapi/` — REST/OpenAPI source documents.
- `graphql/` — GraphQL schemas if adopted.
- `json-schema/` — Shared request/response structures.
- `generated/` — Generated clients and types; never hand-edited.
- `compatibility/` — Breaking-change and backward-compatibility checks.
- `tests/` — Schema examples and consumer contract tests.

Contracts contain transport shapes, not backend implementation or persistence models.

The D1 catalog contract defines a strict `POST /v1/jobs/search` body with bounded supported filters,
an exact `jobs:read` security requirement, active redacted result summaries, and an opaque
continuation cursor. It intentionally excludes saved-job state, profile matching, and unsupported
inferred filters.
