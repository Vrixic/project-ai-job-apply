# Documents Service

Owns immutable source resumes, normalized resume trees, tailored versions, cover letters,
rendering state, version diffs, and artifact metadata.

## Current Phase 1 slice

- `migrations/` owns candidate-resume metadata, idempotency, processing receipts, and value-free
  audit records in the `documents` PostgreSQL schema.
- `src/upload-signer.ts` creates five-minute exact-key S3 POST grants with media type, byte range,
  SHA-256 metadata, and customer-managed KMS conditions.
- `src/index.ts` owns candidate-scoped resume registration/listing and never returns bucket keys,
  object versions, normalized content, or extracted text. It also enforces the plan's stored-resume limit
  and one-upload-at-a-time rule ([ADR-032](../../../docs/adr/032-billing-owned-plan-limits-enforced-by-owning-contexts.md))
  and candidate deletion, a tombstone that hides and frees the resume but keeps its objects until a separate
  purge ([ADR-033](../../../docs/adr/033-resume-deletion-is-a-tombstone-with-a-separate-byte-purge.md)).
- `src/processor.ts` owns fail-closed malware-result transitions and normalized-object metadata;
  resume bytes and block text remain behind the object-store boundary.
- `src/parsing/` performs bounded PDF/DOCX magic, archive, page, and text normalization after a
  clean malware disposition.
- `tests` use synthetic generated documents only. Real resumes are forbidden.

## D3 slice (source and local verification only)

- `src/resume-ast/` builds the normalized resume tree from one immutable normalized document. Every block becomes exactly one node with an exact span; nothing is rewritten.
- `src/tailoring/` selects and orders verbatim bullets by job-term overlap, produces a fixed-reason visible diff, and gates structural factuality (no new text, no cross-entry moves).
- `src/render/` renders DOCX and PDF from a tailored variant and verifies each artifact by re-parsing it with the production parser and comparing text. PDF supports the standard Latin font only.

- `src/resume-tailoring.ts` serves the fixed `resume-tailoring-v1` request from the document processor ([ADR-031](../../../docs/adr/031-deterministic-resume-tailoring-in-documents-runtime.md)): an owner-scoped parsed-resume lookup, the verified normalized read, deterministic tailoring, and verified DOCX/PDF rendering. Nothing is persisted beyond the content hash the packet stores. The dependency-free wire contract is `src/resume-tailoring-contract.ts`, which the Gateway imports.

Generative rewrites are not implemented. Cover-letter preparation (D3-017) is in progress.
The private `./cover-letter-provider` entrypoint supplies transport contracts, injected S3
ports and a source-only handler factory, with no database, renderer or credential bootstrap. Invocation/output
envelopes contain document IDs and exact owned references; prompt/result text lives in canonical
bounded encrypted request/dispatch/result objects beneath `normalized/<documentId>/generation/`.
The document reservation must commit before these writes so the existing exact-prefix deletion
inventory includes them. Conflict returns the existing reference, not new dispatch authority.
Eighty-five offline tests cover ownership, consent/context identity, strict/canonical bytes,
conditional writes, KMS/version/hash checks and stalled-stream cleanup. These ports are uncomposed.
Private provider-call/result recovery composition, bounded privacy quiescence after ambiguous invocation and transient
retention remain required before activation; an aborted private call cannot imply the remote
provider has stopped or cannot write. Production IAM/trigger configuration is not included.

[Proposed ADR-037](../../../docs/adr/037-precreated-cover-letter-provider-slots.md) adds precreated
`issued`/`pending` placeholders and conditional `claimed`/`ready` transitions. References now pin
ETag as well as version/hash/size. `transitionIfMatch` validates the owned historical placeholder
and original request hash, then replaces only its current ETag; missing/conflicting writes never
fall back to creation. Duplicate claims yield at most one successful replacement. A provider
runtime must not receive `putIfAbsent` or creation permissions. The source-only Workflows purge
now fences observed fixed generation slots before removing history, keeps fences until history
is proven absent, then removes them and rechecks the whole inventory. Offline adversarial tests
and connected PostgreSQL deletion/restore tests pass. This is not deployed deletion evidence:
marker-creation IAM is not configured, and a claimed remote model call still needs privacy
quiescence. Provider creation restrictions and transient retention remain unfinished.

`src/cover-letter-provider-handler.ts` is default-off before object/model access. Its frozen
transition-only object facade has no creation operation. It binds the request hash, checks the
original fifteen-minute consent window and approved model alias, and requires a positively
acknowledged conditional dispatch claim before exactly one ModelGateway call. Ambiguous claim
or result writes return `in_progress`, not terminal product failure. Duplicate/retry delivery
recovers only the original encrypted result or waits; it cannot generate again. Saved results
include strict model provenance and the original output-character count, with canonical parsed
JSON text; invocation responses contain only references. Recovery after consent expiry verifies
that the original dispatch was inside the consent window without renewing it. Missing slots,
inconsistent bindings and definitive gateway refusal fail closed. A bounded local deadline
cannot prove remote/provider quiescence. Twenty-five handler cases use the real object transport
with offline versioned S3 and a fake model. Private result grounding/rendering recovery, privacy
authorization/quiescence, retention and production runtime/IAM remain unfinished; do not compose
or activate this factory yet.

`src/cover-letter-provider-initialize.ts` is a default-off private initializer with no model or
Invoke capability. It reconstructs the owned prompt and original consent, commits the Documents
reservation before object I/O, then creates request, pending result and issued dispatch in that
order under an active-candidate lease. Only the first reservation winner can create slots.
Replays pin/read existing objects and never recreate missing slots; partial or ambiguous creation
cannot be resumed into fresh dispatch authorization. They remain inventoried for bounded workflow
compensation and separately approved fresh operations. Outputs contain only references/statuses.
Twenty-one offline cases and one new real PostgreSQL case cover ordering, concurrency, lost ACKs,
removed-slot replay, consent/kill switches and quarantine. Documents passes 333 unit and 36
PostgreSQL cases. Object ports in the new initializer tests are offline; this is not live S3/KMS
or provider evidence. Late private S3 creation after a local abort still needs the unfinished
authorization/quiescence protocol. Do not compose or activate this initializer yet.

`src/cover-letter-provider-recovery.ts` is a private read-only recovery primitive. It accepts
SQL-owned reservation metadata and current owned evidence, reconstructs and compares the exact
prompt, verifies version/digest/size and document/request bindings, and requires matching original
authorized dispatch time and model provenance before pure grounding. An original ready result can
be grounded after disclosure expiry without renewing consent or calling a provider. Missing or
pending results return no draft; changed bindings, corruption and malformed transport fail with a
fixed content-free error, while unsupported model claims are withheld by the shared evaluator.
Twenty-three offline cases pass. The primitive has no object creation, transition, database,
model or rendering capability. `src/cover-letter-draft-recovery.ts` now composes this reader with
an active-candidate owner-scoped metadata lookup, owned evidence, bounded read leases and shared
parser-verified finalization. It has no model/Invoke/reservation capability. Missing reservations
never create work; missing/pending provider results stay in progress. Existing immutable final
drafts are read directly without another provider-result read. Original authorized results can
finish after consent expiry; each immutable completion independently checks the candidate lease.
Seventeen new service cases cover both parser checks, immutable retry/lost completion responses,
context changes and quarantine. Documents passes 333 unit and 36 real PostgreSQL cases, including
two new owned metadata/finalization cases with offline object ports, not live S3/KMS/provider.
Private Invoke and live activity composition remain unfinished and default-dark.

`src/cover-letter.ts` validates a grounded, review-required draft, binds its text/provenance and
job/evidence context to an immutable content hash, and renders packet-bound PDF/DOCX with
production-parser verification. `src/cover-letter-store.ts` reserves an exact object key before
I/O, finalizes immutable metadata with value-free audit events, deduplicates completion and reads
only an exact owner/application/hash binding. Retry recovery uses the original operation's
document identity and exact job/evidence context, never a newer application draft; pending or
missing drafts do not trigger object reads. `src/cover-letter-objects.ts` uses conditional,
KMS-encrypted S3 writes, exact versions, digest verification and bounded streams. Draft text
never enters SQL. The Identity-owned active-candidate lease serializes bounded writes with
privacy quarantine; pending and ready keys both enter the candidate deletion inventory.
Unit tests use generated-synthetic text and an offline S3 transport. Real PostgreSQL integration
verifies migrations/replay, concurrency, immutable completion, lost-response recovery,
quarantine races, owner isolation and authorized deletion. No live S3 or model call is tested.

`src/cover-letter-generation.ts` now composes the AI gateway, owned evidence port, write-ahead
reservation and immutable store. It preserves the original 15-minute disclosure window, uses
the shared full-job/evidence binding, withholds grounding failures and verifies both PDF and DOCX
before marking a draft ready. A repeated internal request recovers the saved draft or reports
in-progress; it cannot generate again. The bounded model call holds the active-candidate lease
without nesting store transactions, so quarantine cannot race provider dispatch. Binding and
file reads invalidate on current context changes and never call a model. Local evidence: 333
Documents unit and 36 real PostgreSQL tests (offline provider/object transport).
The heavy AI/rendering boundary has a private `cover-letter-runtime` package entrypoint for
activity composition; it is deliberately not exported from the Gateway's lightweight root.

The Applications-owned atomic preparation operation and single generation claim have local
PostgreSQL evidence. Privacy export artifact-content assembly, durable workflow,
Applications/Gateway wiring and restore-manifest synchronization remain in progress. There is
no exposed cover-letter service or live model activation. Do not deploy these migrations alone:
strict export consumers must support the additive `documents.coverLetters` metadata projection
before it appears, and new runtime function/object permissions need deployment review.

## Planned expansion

- `tailoring/` — Evidence-grounded selection and rewriting.
- `rendering/` — PDF/DOCX generation and rendered-text verification.
- `factuality/` — Claim provenance, date, contradiction, and unsupported-claim checks.
- `api/` — Later artifact reads, deletion, and version selection.

The service creates documents but does not approve or submit applications. Parsed values become
proposals and cannot be used as confirmed facts without explicit candidate action.
