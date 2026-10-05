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

The internal union also carries metadata-only `not_dispatched` receipts for the gateway's
known local kill-switch/disclosure/input refusals before invoking either provider port.
Provider-thrown identical error codes and thrown local callbacks cannot produce this receipt.
Ordinary `generate` still throws the original fixed refusal code. This is original local
non-dispatch evidence, not a completed response, candidate approval or purge certificate.
The current non-dispatch checkpoint passes 111 offline AI SDK tests, including ordinary refusal
before provider identity access, every local reason and identical provider-thrown codes.

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

### Source-only completion-only disposal

`OpenAiLunaResponseCleanup.deleteCompleted` is a separate completion-only maintenance port.
It requires exact original id/time/model/settings and `completed` status before one DELETE;
queued/running, other terminal states and malformed or missing responses stay unresolved.
It never sends cancellation. Default-off activation, bounded single-attempt I/O, positive
original deletion acknowledgement and metadata-only results preserve the existing transport
policy. The failed/abandoned `stopAndDelete` port retains its cancellation behavior.

This source-only port does not establish owned successful-generation eligibility or compose
runtime/IAM/scheduling. It cannot settle private writers, certify platform quiescence or authorize
object/row purge. Provider acknowledgement loss/404 is unresolved; no elapsed-time inference,
retry, polling or generation is supplied. Offline tests use simulated HTTP only; no activation.

### Source-only original background capture

The opt-in `generateWithBackgroundCapture` path uses a separate provider port, never a
foreground fallback. Gateway kill-switch, disclosure, freshness and input checks precede
reservation. `OpenAiLunaProvider` also requires `backgroundEnabled`; ordinary foreground calls
retain their request/result behavior. The original actor supplies a private metadata-only
capture capability, not SQL or a candidate-selected response id.

Exactly one committed reservation may create one background response. Original id/time capture
must commit before the first poll or accepting even immediate completed output. Same-identity
GET polling is paced, byte-bounded, capped at 30 and constrained by the gateway deadline.
Lost create/capture ACKs, changed metadata, failed/cancelled/incomplete status and local timeout
never retry creation or certify completion. Character/JSON rejection occurs only after original
completed response acknowledgement and durable identity capture. No settlement/disposal or
quiescence authority exists in this transport. Temporary polling state still exists with
`store:false`; no account-level retention or real-provider capability is inferred from offline
tests. Private capture RPC/IAM, disposal reconciliation and deployed acceptance remain pending.

`OpenAiLunaResponseCleanup` is a separate default-off source-only lifecycle capability for an
already-owned, durably captured background response identity. It cannot create or generate a
response. One bounded GET verifies the exact response id, original creation time, selected model,
background execution, `store:false`, no tools and no previous-response linkage. Queued/running
work gets at most one cancel request. Only an exact terminal response permits one DELETE, and
only its exact `response.deleted` acknowledgement yields a metadata-only `response_deleted`
receipt. HTTP 404, expired state, local abort, lost/late acknowledgements and malformed responses
remain unresolved, without retry or a new model call. Response bodies are byte-bounded and never
returned as draft content, logs or diagnostics. The local deadline is not provider stop proof.

The owner approved the source-only background temporary-retention tradeoff on 2026-10-03.
Official documentation describes roughly ten minutes of temporary polling state even with
`store:false`; this is not a maximum retention guarantee or Zero Data Retention approval.
Response deletion does not certify removal of abuse-monitoring or other provider copies.
The existing foreground adapter remains unchanged. Original background creation through the
gateway, durable immutable response-to-work binding, lost-creation-ACK handling, private-writer
drain, maintained disposal reconciliation, authenticated runtime/IAM and accountable acceptance
remain unfinished. Never compose this reference-only port from a candidate-supplied response id,
or connect its receipt directly to platform deletion/quiescence. No activation/live calls occur.

Offline evidence: 59 cleanup cases and all 170 AI SDK tests pass, with package typecheck.
The complete repository verifier passes: 38 typecheck tasks, workspace tests, 23 builds,
formatting and baseline-only lint (15 warnings/58 infos), operational/dependency-security
regressions, Compose and scope. The separate live dependency audit still fails without waiver.
No database, cloud or live provider behavior is claimed for this stateless transport layer.
Documentation: [background lifecycle](https://developers.openai.com/api/docs/guides/background),
[cancel](https://developers.openai.com/api/reference/typescript/resources/responses/methods/cancel),
[delete](https://developers.openai.com/api/reference/resources/responses/methods/delete).

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

## Original background terminal receipts

`generateWithBackgroundTermination` is an additive private opt-in. It returns a metadata-only
`terminal_no_content` receipt for an originally observed `failed`, `cancelled` or `incomplete`
response only after acknowledged creation capture and exact response id/time validation.
Completed responses retain ordinary output validation. The old background and foreground APIs
retain their return types and error behavior; older providers may use the existing background
port once, without retry on failure. Thrown errors, HTTP 404, timeout, lost capture acknowledgement
and late fulfillment cannot become terminal receipts. This proves the original response's
terminal observation, not provider-wide deletion or platform writer quiescence.
Generated cover letters and improved resumes must follow
[ADR-038](../../docs/adr/038-one-off-generated-application-materials.md): temporary, one-off content,
maximum 30 minutes from generation completion, no database or other persisted content. The offline
`toGeneratedProposal` helper does not enforce this lifecycle; its cover-letter output must not be
saved in Applications packet fields. D3-064 tracks that integration guard and cleanup evidence;
D3-012 still blocks live provider use.
The source-only background adapter and disposal receipts above do not establish the required
30-minute maximum for all provider copies; reviewed provider terms and end-to-end evidence remain
necessary before activation under this policy.

`provider-background-contract.ts` holds unchanged pure captured-response/original-terminal
metadata validators. Existing gateway and response-cleanup exports remain compatible reexports.
Private ledger composition can retain validation without emitting model or cleanup implementations.

`generateOriginalWithCompletion` is the foreground original actor path. It captures the original
provider fulfillment clock before decoding and keeps awaiting that original promise after its
timeout requests cancellation. Late fulfilled content is withheld through a value-free
`completed_discarded` receipt. Unknown rejection remains an exception with no settlement proof;
there is no background request or fallback dispatch. Existing `generateWithCompletion` receipts
are unchanged. Hosts must bound admission and physically retire non-acknowledging actors; this
method intentionally cannot make abort into remote-stop or provider-retention evidence.
