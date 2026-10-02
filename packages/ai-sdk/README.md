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

## OpenAI development adapter

`OpenAiLunaProvider` implements the existing provider port with native fetch and the fixed
OpenAI Responses endpoint/model `gpt-6-luna`. Compose it through `ModelGateway` and the grounded
generation functions, never directly from a client or service. Both the provider and gateway
require explicit activation; credentials alone do not enable calls. No runtime composition,
environment switch, API, or deployment is added by this adapter slice.

The request uses strict paragraph/fact-reference Structured Outputs, `store: false`, foreground
non-streaming execution, low reasoning effort, a 4,096-token ceiling (including reasoning), and
no tools, retries, or redirects. The response stream is capped at 128,000 bytes; draft characters
are bounded separately. Refusal, incomplete, malformed, unexpected-tool and HTTP failures expose
fixed errors only. Gateway cancellation reaches fetch. Grounding and mandatory review still run
after transport; a schema-conforming draft is not evidence of truthfulness.

The model identity records the selected alias, not a dated snapshot or a reproducibility promise.
Offline transport tests are not real-model quality or account-access evidence. Live evaluation,
packet wiring, candidate notice/approval transport and hosted acceptance remain outstanding.
See the [development provider decision](../../docs/security/d3-012-accountable-disposition.md#openai-development-decision-2026-10-02).
