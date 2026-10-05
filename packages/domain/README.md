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

Application packets and portable candidate exports support optional closed saved-answer reference
metadata. Fields carrying references must retain answer-vault origin and mandatory review.
Old strict readers reject these additions, so deploy compatible readers before enabling producers.

`@ai-job-apply/domain/temporary-material` is the pure scalar reference/validation entrypoint for
Documents control and Applications packet admission. It exposes no content, renderer, persistence
or provider capability. Original generation identity/completion plus fixed 1,800,000 ms expiry
participate in packet hashes; public/portable projections omit reference ownership fields.
Arithmetic expiry and current availability are enforced by runtime/native owner admission, in
addition to strict JSON shape validation. Old strict consumers require upgrade before production.
Accepted ADR-038 prohibits activating legacy saved generated-cover-letter paragraphs/export bodies;
those existing schema variants do not authorize generated-material retention.
