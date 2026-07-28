# AI SDK

Provides the approved interface for model use, structured output, prompt/version management, grounding, safety checks, and provider-independent telemetry.

## Planned subfolders

- `gateway/` — Task and provider interfaces.
- `prompts/` — Versioned prompt definitions.
- `schemas/` — Structured input/output contracts.
- `grounding/` — Fact references and unsupported-claim detection.
- `safety/` — Prompt injection, PII, and tool policy.
- `routing/` — Model capability, fallback, and budget policy.
- `testing/` — Fake providers, golden cases, and adversarial harness.

Clients and services must use this package rather than invoking model providers directly.
