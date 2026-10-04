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
The separate source-only response-disposal v1 RPC exposes exact original inventory reads and
positive terminal-deletion receipt persistence to private maintenance. It defaults off, pins
one numeric Lambda target, permits one SDK attempt and carries metadata only. Unknown identity,
lost acknowledgements and deadlines remain unresolved; disposed inventory does not settle work
or authorize platform purge. Existing capture/work/fence contracts are unchanged. Its handler
must be published and bound through reviewed maintenance-only IAM before its client is composed.

The source-only `cover-letter-response-disposal-lambda` bootstrap uses the shared lazy
target/managed-secret policy and a native one-connection pool supplying read/recordDisposal only.
Its independent `COVER_LETTER_RESPONSE_DISPOSAL_ENABLED` flag defaults off. Reviewed runtime/IAM,
successful-generation disposal, writer drain and deployment remain unfinished.
Offline Lambda/provider transports and generated-synthetic PostgreSQL tests
are layer evidence, not live provider or retention evidence.

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

Private pending-draft recovery defaults off. Its explicit private enablement does not enable any
public route, provider dispatch or deployment. It reconstructs the original request digest and
passes it to final persistence. `PostgresCoverLetterStore.complete` remains the sole final-write
admission and settlement owner: no second service-level claim is made. Claimed references must
be exact descriptor-data objects bound to this document, final purpose and original digest.
A local 60-second admission deadline prevents starting a new object write after a late claim
acknowledgement; it never settles or cancels running work. Original positive creation plus exact
pinned read are required for settlement. Lost acknowledgements remain unresolved; read-only
immutable recovery may repair ready metadata but cannot repeat writes or settle uncertain work.
`src/cover-letter-provider-invoke.ts` now supplies a default-off private SDK adapter pinned to an
exact numeric Lambda version. It snapshots strict identifier/reference inputs, requires the SDK's
single-attempt policy, invokes synchronously without logs, and admits only bounded strict original
responses. Ambiguous transport/function/receipt failures stay in progress for original recovery;
local abort never proves remote quiescence. Sixty focused tests pass, including the installed SDK
with offline HTTP success/failure responses. It has no model, database or object-write capability.
Live activity composition remains unfinished and default-dark until privacy, retention and reviewed
runtime/IAM prerequisites pass. No provider or AWS call was used for these tests.

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

## Private original-response capture RPC

The separate local `build:lambda:private-controls` command now builds exactly the provider-control,
response-capture, cleanup and response-disposal entrypoints into `dist/private-control-lambda`. Actual bundled handlers
must refuse valid work while their independent flags are off and reject additional content fields
without secret fetches. The publisher's `PrivateDocumentControls` family has dedicated receipt,
operator and immutable key roots and exactly sixteen companion objects; legacy parser/processor
receipts remain unchanged. This source wiring is not publication, deployment, IAM authentication
or remote-quiescence proof. Runtime composition and activation remain unfinished and default-off.

### Source-only provider-work control Lambda bootstrap

`src/cover-letter-cleanup-lambda.ts` is a separate source-only maintenance fence entrypoint.
Its independent `COVER_LETTER_CLEANUP_CONTROL_ENABLED=true` gate uses the same shared lazy
target/managed-secret policy and a native one-connection pool. Only the existing Documents
`fenceForCleanup` method is bound. Running work stays pending; unclaimed admission is permanently
fenced, including during quarantine. A lost original ACK stays unavailable, not terminal.
There is no settlement, renewal, capture/read/disposal, model/object/render/Invoke or purge port.
Even `ledger_terminal` is not a quiescence certificate or permission to delete objects. Reviewed
maintenance-only caller IAM, build/guard wiring, deployment and activation remain unfinished.

The separate `src/cover-letter-response-capture-lambda.ts` entrypoint supplies only existing
`reserve` and `recordCreation` controls, with its independent default-off
`COVER_LETTER_RESPONSE_CAPTURE_ENABLED=true` gate. Both private entrypoints use the shared
`src/private-documents-lambda.ts` lazy managed-secret/target policy, preserving validation before
I/O, input snapshots, numeric invoked-target binding, bounded read-only setup and no warm rebind.
Capture uses a native one-connection pool without ORM timestamp parser mutation. Its original
transactions are awaited, never raced/retried or inferred from an ACK timeout. Quarantined or
expired original work may drain a creation ACK only under the existing store rules; reservation
replay is not a new dispatch grant. Capture cannot read/dispose responses or settle work.
Neither source is artifact-wired, caller-authenticated, activated or deployed. Reviewed IAM,
private writer drain and complete quiescence remain mandatory separate gates.

`src/cover-letter-provider-control-lambda.ts` is a lazy private entrypoint for the existing
provider-work RPC, not a public API or deployed artifact. The only enable spelling is
`COVER_LETTER_PROVIDER_CONTROL_ENABLED=true`; missing/other values refuse before I/O. Trusted
runtime region/account/function metadata must form an exact positive numeric-version ARN matching
the invoked target. A qualified same-account `DATABASE_SECRET_ID` and runtime session context are
required; embedded `DATABASE_URL` is refused. The existing Parameters/Secrets extension helper
resolves the managed secret with one bounded read attempt. Single-flight setup creates one
one-connection native PostgreSQL pool and supplies only the existing provider claim/settlement controls.
The raw ledger retains native Date timestamp parsing; the ORM database helper must not be used
because its driver replaces timestamp parsers with string passthrough.
Warm target/secret rebinding, withdrawn activation and failed bootstrap refuse without ledger
effects. Failed read-only initialization may retry later; original effect calls are never raced
or retried here. Input and output retain the existing identifier-only RPC contracts.

Exact target matching is not caller authentication. This source is not wired into the current
parser/processor artifact builder. Reviewed exact-version caller IAM, private database/secret
permissions, build/guard wiring, deployment and activation remain separate unfinished gates.
There is no issue/renewal, maintenance, model, object, renderer, Invoke or purge capability, and
no quiescence, provider deletion or phase-completion claim follows from bootstrap success.

`cover-letter-response-reconciliation.ts` adds source-only private maintenance for FAILED or
ABANDONED work, not successful/active generation. The default-off reconciler first commits the
existing owner-scoped permanent admission fence, then reads exact original response inventory.
Only a positively bound terminal/deletion acknowledgement reaches disposal persistence, followed
by durable-state convergence. Replay of committed disposal skips provider I/O. Missing identities,
lost deletion ACKs, 404 and local deadlines remain unresolved. Neither the fence nor response
disposal settles running writers, certifies platform quiescence or authorizes object/row purge.
Reviewed maintenance IAM/runtime, scheduling, successful-generation cleanup and writer drain are
not composed or activated. Provider/model/cloud ports in tests are synthetic only.

The source-only private original-response capture RPC is separate from work control and
maintenance. `cover-letter-response-capture-contract.ts` defines closed metadata-only v1
reserve/record-creation envelopes; the provider-only client pins a numeric Lambda version,
requires one SDK attempt, validates bounded canonical original receipts and defaults off.
The Documents-only handler awaits owner transactions; lost acknowledgements remain unresolved.
It exposes no content, inventory read, disposal, work settlement, renewal, generation or purge.
Exact invoked-target matching is not caller authentication. Reviewed caller IAM, private runtime
composition, maintained disposal/writer drain and deployed acceptance remain unfinished.

## Private saved cover-letter reads

`src/cover-letter-read.ts` separates existing context, binding, preview and file behavior from
generation. Its constructor accepts only a read-store lease and owned evidence; no ModelGateway,
Invoke, reservation, recovery, work-ledger or mutation capability is supplied. The private runtime
entrypoint exports it, not the Gateway's lightweight root. Public routes and schemas are unchanged;
production runtime composition remains unfinished and default-dark.

`PostgresCoverLetterReadStore` accepts only exact-version object reads. One Identity-owned
active-candidate transaction covers owned metadata lookup, pinned object verification, current
evidence comparison and rendering. Its callback receives an owner-fixed transaction reader, so
saved-document reads do not start nested pool transactions. Evidence must still come from owning
service APIs; their independent pools must not borrow this reserved Documents connection.
Missing/foreign/stale packet behavior is preserved; inactive or missing candidates are refused
before evidence or object access. Reads do not renew consent or generate missing content.

Local synthetic evidence: 578 unit tests, 116 Documents PostgreSQL cases (including all 66 opt-in
work-store cases) and six connected preparation-workflow cases pass. Four new quarantine races
exercise context/binding/preview/file with a single-connection read pool. Model/object ports are
offline, not live AWS/model or deployed acceptance. The full maintained repository verifier passes:
unchanged generated contracts, operator guards, formatting, lint, typechecks, tests, builds,
dependency-security regressions, Compose and scope. This does not clear the separate scanner or
live dependency audit, and does not approve runtime activation.

## Private failed/abandoned-work cleanup control

The source-only `cover-letter-cleanup-contract.ts` and `cover-letter-cleanup-handler.ts`
define a separate version-one maintenance boundary, exported only from the private runtime.
Path: trusted private maintenance caller -> strict reference envelope -> Documents-owned
work ledger -> permanent admission fence -> reference-only operational receipt.
The isolated provider's claim/positive-settlement contract and capabilities are unchanged.

An exact existing grant/document/purpose/request digest resolves the persisted owner; the caller
cannot select an owner or certify stopped work. `fenceForCleanup` revokes unclaimed authority and
inserts permanent revoked tombstones for phases not yet issued using the existing `0007` protocol.
Replay preserves original identities and admission deadlines, including after quarantine or a
lost response. Unknown/conflicting references cannot create or cancel work. A concurrent claim
either loses to revocation or remains running; cleanup never settles it. Late positive provider
settlement cannot grant finalization once the final phase is fenced.

Outcomes are `pending`, `ledger_terminal` or `unavailable`. **None proves remote quiescence or
authorizes object/row purge.** This boundary receives no settlement, model, Invoke, object-I/O or
deletion capability. Running/ambiguous work and its reservation inventory remain until independent
trusted positive completion. Failed-call stopping evidence, transient retention enforcement and
production maintenance authentication/IAM/bootstrap remain unfinished. Numeric invoked-target
matching is not caller authentication. Both handler and ledger default off; no public API,
frontend, migration, guard, Terraform, AWS/model call or deployment is included.

Local synthetic evidence: 31 cleanup contract/handler cases, one additional default-off ledger
case, all 610 Documents unit tests and 82 opt-in real PostgreSQL ledger cases (16 new cleanup
cases) pass. Object/model/Lambda transports in the connected suite are offline, not deployed
authentication or remote-stopped evidence.

The full maintained repository verifier passes, including 38 typecheck tasks, workspace tests,
23 builds, unchanged generated contracts, formatting, baseline-only lint, operational and
dependency-security regressions, Compose and scope. The separate fresh live dependency audit
still fails on existing mobile-only node-forge/braces advisories; no waiver or dependency edit.

## Internal rejected-provider completion control

The private v1 control also accepts additive `settle_undispatched`, only for the original
gateway-local non-dispatch receipt after acknowledged dispatch-slot replacement. The isolated
actor validates original prompt/model provenance and local refusal code, then sends only its
exact existing grant reference. Documents fences future phases before settlement; no model,
result write or finalization follows. Older capability compositions fail closed; control must
be upgraded before the actor. Provider-thrown errors, lost acknowledgements, aborts and timeouts
remain unresolved. This reuses existing persisted states without migrations or public changes,
and never certifies production quiescence or authorizes object/row purge.
The current non-dispatch checkpoint passes 660 Documents unit cases and 106 real PostgreSQL
ledger cases. Final-source SQL rerun includes private control round-trip, quarantine, exact
binding/refused-state checks, immutable replay and committed-but-lost closure acknowledgement.
Object/model/Lambda ports are synthetic. Full maintained verification passes, including all
38 typecheck tasks and 23 builds; the separate live dependency audit remains failing without
waiver. Disposable fixtures are removed and Docker Desktop/WSL stopped; shared volumes retained.

The source-only private provider-control v1 adds `settle_rejected` to existing claim/settle
operations. Only the trusted original isolated actor, after original provider fulfillment and
validated gateway provenance, may invoke it for JSON/output rejection. Its envelope contains
only the existing grant/document/fixed-purpose/request-digest reference. Documents resolves
the owner, permanently fences unclaimed and not-yet-issued phases, then settles the original
running provider phase. Quarantine does not prevent draining that original completed work.
Replay preserves original IDs/deadlines/terminal timestamps; wrong or unclaimed references fail
without cancellation. A settlement failure after the committed fence leaves pending work and
prevents finalization. No rejected result, final document or object/row purge is produced.

Missing older capabilities, unavailable/lost acknowledgements, provider errors and timeouts
never grant settlement or repeat dispatch. Exact-version single-attempt transport stays default
off; invoke-target matching is not authentication. Rollout must compose matching reviewed private
control before the actor, separately from this source change. Trusted failed-call stop evidence,
production runtime/IAM, retention and privacy quiescence remain open. No public API/frontend,
migration, guard/Terraform, cloud/model call or deployment is included. Local synthetic evidence:
643 Documents unit tests and 95 opt-in PostgreSQL ledger cases pass; object/model/Lambda ports
are offline, not deployed or live-provider proof.

The connected rejected-output pipeline now uses the actual OpenAI adapter with an offline HTTP
transport, including oversized completed responses and lost control ACKs. This catches an earlier
adapter-level character rejection that bypassed original-completion receipts. Incomplete provider
responses remain unresolved; ordinary adapter/generation errors and request settings are unchanged.

The full maintained repository verifier passes (38 typecheck tasks, workspace tests and 23
builds), including unchanged generated contracts, formatting, baseline lint, operator and
dependency-security regressions, Compose and scope. Separate live dependency audit remains
failing without waiver. The synthetic database was removed; Docker Desktop/WSL are stopped.

## Durable original provider response inventory

The opt-in isolated actor `responseCapture` port now connects the original grant to the
gateway's separate background path. It requires strict reserve/capture capabilities before
claiming; after the acknowledged dispatch-slot replacement it supplies exact original-reference
closures. Consent/deadline and activation are rechecked after reservation before creation.
Creation capture precedes result writes and original settlement; ambiguous capture cannot write,
settle or redispatch. Existing foreground and original local non-dispatch closure behavior stay
unchanged. The isolated actor still has no database bootstrap: authenticated private capture RPC
and reviewed caller IAM are not yet composed. Response disposal and writer-drain/quiescence
proof remain separate requirements, even after successful background generation.

`0008_cover_letter_provider_responses` and the private-runtime-only
`PostgresCoverLetterResponseStore` reserve identifier-only inventory against a running original
provider grant before external creation. Only a committed first reservation returns `reserved`;
replay returns `already_reserved`, never another dispatch authority. Active-candidate admission,
the original non-renewable deadline and consent are checked before reservation. A missing creation
ACK leaves the reserved row with no response id; it cannot become stopped through time or 404.

Original id/time capture is immutable and unique across work grants. Positive disposal binds to
that exact stored reference and fixed terminal status. ACK draining is permitted after quarantine
or expiry without generating, renewing consent or settling work. Replays preserve timestamps;
conflicting references/statuses fail with a content-free error. Direct SQL guards enforce binding,
state transitions and inventory retention. Even settled work cannot cascade-delete an unresolved
response, and disposal does not bypass the original private-work deletion guard.

This is a default-off private ledger API, not a public endpoint or authenticated cloud composition.
Original gateway/actor capture, lost-create-ACK reconciliation, private writer drain and maintained
disposal reconciliation remain pending. Neither a stored response nor a disposal receipt proves
platform quiescence or provider-wide deletion. Apply the forward migration with compatible restore
and maintenance consumers before any separately reviewed activation. No guessed-identity backfill.

## Planned expansion

- `tailoring/` — Evidence-grounded selection and rewriting.
- `rendering/` — PDF/DOCX generation and rendered-text verification.
- `factuality/` — Claim provenance, date, contradiction, and unsupported-claim checks.
- `api/` — Later artifact reads, deletion, and version selection.

The service creates documents but does not approve or submit applications. Parsed values become
proposals and cannot be used as confirmed facts without explicit candidate action.
