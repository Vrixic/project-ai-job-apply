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

`jobs.ingestion.dispatch.nudge.v1` is the strict identifier-only SQS hint for a Jobs-owned durable
ingestion dispatch. It carries no source payload or job values and includes a SHA-256 integrity
binding over its exact identity, checkpoint revision, and workflow generation.

`job.contributed.v1` contains exactly one UUIDv7 `contributionId`. Workers must reload the
Jobs-owned queued record; job fields, URLs, contributor identity, consent identity, and source
metadata never enter the event.
