# Event Contracts

Defines append-only, schema-versioned events exchanged by backend services, workers, workflows, and analytics.

## Planned subfolders

- `schemas/` — Versioned event payload definitions.
- `envelopes/` — IDs, timestamps, causation, correlation, and metadata.
- `registry/` — Event names, owners, and data-classification records.
- `generated/` — Generated producers, consumers, and validators.
- `compatibility/` — Forward/backward compatibility checks.
- `examples/` — Synthetic valid examples.
- `tests/` — Schema and redaction tests.

Events carry identifiers and necessary facts, never unrestricted resumes, tokens, or sensitive form values.
