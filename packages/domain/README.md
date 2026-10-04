# Shared Domain Primitives

Contains pure, stable value objects and primitives that have identical meaning across domains, without infrastructure or framework dependencies.

## Planned subfolders

- `ids/` — Typed identifiers.
- `time/` — Timestamps, date ranges, and clock abstractions.
- `money/` — Currency and compensation value objects.
- `location/` — Normalized geographic primitives.
- `result/` — Explicit success/failure types.
- `errors/` — Stable domain error codes.
- `tests/` — Invariant and serialization tests.
- `schemas/v1/` — Versioned domain entity schemas and their ownership registry.

Service-specific entities and policies stay with their owning service instead of being centralized here.

CandidateDataExport v1 optionally carries ready cover-letter paragraphs with `reviewRequired=true`.
The bounded fields appear together; pending letters cannot contain them. Existing metadata-only
exports remain valid, while old strict readers require upgrade before the producer is activated.
No object identities, prompts, grants or provider responses enter this portability extension.
