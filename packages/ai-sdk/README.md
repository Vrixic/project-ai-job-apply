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

Disclosure freshness fails closed on invalid approval or clock timestamps and non-finite or
negative lifetime configuration. The default remains 15 minutes, including its exact boundary.
Rejection uses the existing `DISCLOSURE_STALE` code and happens before provider access.

`coverLetterContext` returns internal evidence/job hashes using generation's same bounded,
latest-version, confirmed non-restricted career-fact selection. It binds evidence confidence and
the complete posting, not just the truncated prompt. Six offline cases cover deterministic
ordering, version/eligibility changes, expiry/security holds and selection bounds. Applications
and Documents still need to compose this helper into the preparation and approval paths.

Grounding also refuses citations to otherwise usable facts excluded from this request's prompt
(restricted, non-career or beyond the selection limit). Existing unknown/unusable-fact reasons
are preserved. Three offline regressions cover this request-specific citation boundary.

## Internal lifecycle completion receipts

`ModelGateway.generateWithCompletion` is an internal lifecycle interface. Only an original
fulfilled provider response yields `completed` or a content-free `completed_rejected` receipt
for oversized/non-JSON output. Model and prompt provenance are captured before dispatch.
Provider-thrown gateway errors, failed ports, aborts and late responses after timeout still throw;
error codes cannot certify completion. Ordinary `generate` preserves its result/error contract.
Provider-port fulfillment must acknowledge original completion, not enqueue background work.
These receipts are not approval or remote-quiescence certificates. All 97 AI SDK offline tests
pass, including original/late completion, provenance mutation and ordinary API compatibility.

The optional internal `ModelProvider.completeForLifecycle` path allows the approved adapter to
acknowledge its original, byte-bounded completed response before downstream character/JSON
rejection. `OpenAiLunaProvider.complete` still applies its original character bound and error
contract. The gateway selects exactly one path; a lifecycle-port rejection never triggers an
ordinary fallback dispatch. Request settings, model, endpoint, byte limits and activation remain
unchanged. Real adapter composition uses offline HTTP responses in tests, never live calls.

## OpenAI development adapter

`prepareCoverLetterPrompt` reconstructs the exact selected-evidence prompt without a gateway.
`groundCoverLetterOutput` evaluates an already obtained structured value using the same evaluator
as ordinary cover-letter and narrative generation. It requires no provider or renewed disclosure,
but is not dispatch authorization: private callers must verify saved request/result integrity,
original consent and model provenance separately. Fourteen offline cases prove parity with the
existing generation path, withheld unsupported output, selection bounds and unusable evidence.
At that helper checkpoint, the AI SDK passed 81 unit tests. These helpers alone do not finalize
a recovered draft; the current completion-receipt checkpoint above has additional coverage.

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
