# Asynchronous Workers

Workers execute unreliable or resource-intensive tasks outside synchronous API requests. They consume durable work, report structured results, and may be retried without duplicating side effects.

## Subfolders

- `ingestion/` — Job acquisition, normalization, verification, and indexing.
- `ai/` — Model-powered structured generation and evaluation.
- `browser-automation/` — Isolated remote browser runtime.
- `ats-greenhouse/` — Greenhouse-specific behavior.
- `ats-lever/` — Lever-specific behavior.
- `ats-ashby/` — Ashby-specific behavior.
- `ats-workday/` — Workday-specific behavior.
- `messaging/` — Email, push, webhook, and digest delivery.

Worker pools are isolated by provider/risk so one failing integration cannot consume all system capacity.
