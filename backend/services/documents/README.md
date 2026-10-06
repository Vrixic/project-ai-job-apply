# Documents Service

Private native owner RPC source now connects task authentication before lazy owner access,
original reviewed evidence/consent, owning admission and scalar work/completion. It defaults off,
requires a numeric receiver and explicit original task deployment, and never accepts standalone
scalar requests as a fallback. Proof headers are ephemeral and never enter owner adapters or
responses. See [configuration and local evidence](../../../docs/product/delivery/evidence/d3-native-owner-rpc-2026-10-06.md).
Native image/bootstrap/IAM/routing/managed/provider/client acceptance still gates activation.


Private `./native-task-caller-client` and `./native-task-caller-verifier` supply default-off
original-task authentication before future native owner/control RPC admission. Actual SDK SigV4
signing binds fixed allocation/target/request metadata; the verifier forwards only the fixed
regional STS identity action and checks the trusted role and original task session. Production
signing uses only the fixed ECS task credential endpoint. Credential-bearing proofs are ephemeral,
never logged or persisted. This is authentication source, not deployed IAM/physical liveness,
owning admission, provider settlement or purge evidence. Authenticated RPC source is present; managed composition remains required.

The private `./native-cover-letter-runtime` connects one admitted native original allocation to
scalar work/completion ports, the actual memory actor/renderers and authenticated HTTPS reads.
Defaults remain off; trusted launch, owner/provider/TLS adapters, native image/routing and managed
retirement conformance remain release gates. It exposes non-content metadata and its server,
without exporting the raw session reader or claiming death/provider settlement on termination.

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
The separate source-only response-disposal v1 RPC exposes exact original inventory/complete-eligibility reads and
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

## Original failed background work settlement

The captured actor uses the additive terminal gateway path and separate private v1
`settle_terminal` action. Its closed metadata envelope echoes the original work reference,
response id/time and failed/cancelled/incomplete status. The numeric-version client uses one
SDK attempt and refuses mismatched echoes. Older handler compositions refuse this action
without falling back to ordinary or rejected-output settlement.

The default-off native control bootstrap binds the owning SQL operation. In one transaction,
it validates the exact owned acknowledged response inventory (or matching disposed status),
fences unclaimed future phases and settles only the original running provider grant. Replay
preserves its terminal timestamp. Quarantine does not prevent draining original work; it still
prevents new admission. Running private/final writers remain running. No SQL lock spans provider
I/O. Inventory remains unchanged and no result object is written by this path.

This remains an authenticated private-runtime responsibility. Deploy the compatible control
handler before a separately reviewed actor pinned to its numeric version; an older composition
leaves work unresolved. No public API, migration or backfill changes are required. Timeouts,
404, lost capture/settlement acknowledgements and generic errors never authorize another call
or certify quiescence. Private writer drain, disposal maintenance, IAM and deployed acceptance
remain open; nothing is activated by this source change.

[ADR-038](../../../docs/adr/038-one-off-generated-application-materials.md) requires generated cover
letters and improved/tailored resumes to be one-off, temporary materials with a maximum 30-minute
lifetime from generation completion. Persist only hashes and minimal non-content metadata, never
the text, diffs, files, or packet-field copies. Deterministic tailoring already avoids persistence;
deadline enforcement and temporary-copy cleanup remain D3-064 work, not verified deployed behavior.
The existing source-only saved-cover-letter and encrypted provider-slot paths described above do
not satisfy this new policy. D3-064 must revise them before activation while preserving positive
remote-settlement, deletion-fencing, and duplicate-prevention controls.

## Planned expansion

- `tailoring/` — Evidence-grounded selection and rewriting.
- `rendering/` — PDF/DOCX generation and rendered-text verification.
- `factuality/` — Claim provenance, date, contradiction, and unsupported-claim checks.
- `api/` — Owner-scoped source-document management and temporary generated-material reads with expiry enforcement; no saved generated-document library.

The service creates documents but does not approve or submit applications. Parsed values become
proposals and cannot be used as confirmed facts without explicit candidate action.


## Source-only successful-generation response maintenance

`readCompleted` admits exact original metadata only when the owned draft is durably ready and
all three request-bound work phases are positively settled. Missing, running or revoked phases
refuse; no deadline inference is used. Quarantined owners may drain existing completed responses
without a candidate lease or fresh admission. Disposed non-completed responses cannot satisfy
successful replay. This read exposes no draft text or quiescence/purge certificate.

`createCoverLetterSuccessfulResponseReconciler` uses this owning read and the separate
completion-only provider port, never ordinary inventory or failed-work cancellation/fencing.
Exact original completed deletion receipts precede durable disposal; convergence readback is
required. Lost SQL ACK recovers from eligible disposed inventory without repeating provider I/O;
lost provider ACK or subsequent 404 stays unresolved. Defaults remain off. No work settlement,
renewal, dispatch, document write or platform purge capability is supplied. Private eligibility
RPC, reviewed runtime/IAM, scheduling, writer drain and deployed acceptance remain unfinished.


### Private completed-eligibility RPC compatibility

The metadata-only disposal v1 contract adds `read_completed`, retaining `read` and
`record_disposal` shapes. Exact action/reference echoes distinguish the owning completed
eligibility read from ordinary inventory. The client exposes `readCompleted`; the existing
lazy, default-off disposal bootstrap binds the owning SQL method after target/managed-secret
validation. No new function, flag, artifact family, credential or effect authority is introduced.

Older composed stores may omit the optional method; the new action returns unavailable without
ordinary-inventory fallback. Older deployed handler versions refuse unsupported new requests;
new clients do not retry or downgrade. Roll out the new handler first, then pin clients to its
exact numeric version under reviewed maintenance-only IAM. Ordinary read/disposal clients retain
their existing protocol. Missing eligibility remains null, never completion or purge authority.
No migration/backfill is needed. This is local/source compatibility evidence; cloud publication,
runtime/IAM, maintained scheduling, writer drain and deployed/accountable acceptance remain.

## Source-only isolated provider Lambda bootstrap

`src/cover-letter-isolated-provider-lambda.ts` supplies a separate default-off entrypoint for
the existing background actor. `COVER_LETTER_ISOLATED_PROVIDER_ENABLED` and
`COVER_LETTER_BACKGROUND_PROVIDER_ENABLED` must both be exactly `true`. Configuration checks
the qualified invoked numeric version, `us-east-2`/account, three distinct function identities,
exact same-account control/capture versions, the candidate-document bucket, a same-account
KMS key and a qualified provider secret before I/O. Target matching is not caller authentication.

`DATABASE_URL`, `DATABASE_SECRET_ID` and `OPENAI_API_KEY` are rejected, including empty configured
values. The fixed localhost Lambda extension endpoint reads a bounded plain-string provider
key with one attempt, a three-second deadline and a 4,096-byte response limit. Errors contain
no secret/transport diagnostic. Concurrent setup coalesces secret reads; completed invocations
do not retain keys. The extension owns its managed cache/rotation. No environment key fallback
or Profile/database dependency is imported.

Native S3 and Lambda clients use one attempt and ignore configured endpoint overrides. The
actor receives only the frozen find/read/conditional-transition facade plus exact-version
work-control and creation-capture clients; it cannot initialize objects, renew work or dispose
responses through those ports. Actual creation/deletion denial still requires reviewed IAM.
Completed results preserve the original one-dispatch/capture/provenance protocol; ambiguous
ACKs remain unresolved and replay cannot call the model again.

Required environment identifiers: `CANDIDATE_DOCUMENT_BUCKET`, `PLATFORM_KMS_KEY_ARN`,
`COVER_LETTER_OPENAI_SECRET_ID`, `COVER_LETTER_PROVIDER_CONTROL_FUNCTION_ARN` and
`COVER_LETTER_RESPONSE_CAPTURE_FUNCTION_ARN`, plus the established Lambda region/account/name/
version/session context. Secret values are never configuration inputs. No environment/runtime
resource is wired by this source change. Pair a reviewed actor with compatible numeric private
handler versions. The combined D3-063/D3-064 source routes original failed/cancelled/incomplete
observations through the separate terminal settlement action; replay cannot redispatch.

`pnpm --filter @ai-job-apply/documents-service build:lambda:isolated-provider` builds one artifact set
(four local files) in its separate output directory. It smoke-tests the actual
bundled default-off/closed-envelope behavior. The full verifier also checks that the bundle
excludes SQL, private persistence, rendering, test fixtures and disposal capability. Existing
private-control/document publication families are unchanged; no isolated-provider publisher is
introduced. Reviewed role/bucket/KMS/secret/private-caller IAM, original writer drain, maintenance
and transient retention, real-provider evaluation, accountable review and deployed acceptance
remain prerequisites to deployment/activation.


Source-only D3-065 requires Documents-owned original-failure eligibility before failed-response
maintenance can fence work or call the provider. Migration `0009` records only fixed failure
reasons selected by the existing original actor's settlement methods, atomically with future
phase fencing. `readFailed` requires a pending owned document, exact captured response, settled
original failure and revoked final authority. Generic fences, old NULL settlements, successful
work, unknown response identities and non-dispatch receipts cannot qualify. Disposed receipts
must retain the original terminal status (completed for rejected completed output).

The separate private v1 disposal RPC adds `read_failed` with exact action/reference echoes; old
compositions refuse without ordinary-inventory fallback. The native default-off bootstrap binds
the owned read. Reconciliation converges through the same eligibility read, preserves ambiguous
acknowledgements, and settles no other writer. Ambiguous abandoned operations still need a
separate owning abandonment decision/drain protocol; caller labels and elapsed time grant none.
Migration-before-code, reviewed IAM, maintained scheduling, retention, writer drain and deployed
acceptance remain prerequisites. No public API, frontend, provider call or activation changes.

## Source-only native response maintenance (D3-066)

`cover-letter-response-maintenance-lambda.ts` connects owning private `read_failed`/
`read_completed`, failed-only cleanup fencing and positive disposal persistence to the
existing fixed-provider cleanup adapter. Both selectors default off; selectors never classify
work. Missing/unknown/unclassified proof refuses before fence, managed-key read or provider
effects. Successful cleanup has no fence/cancel capability. Numeric same-account distinct
targets and managed-secret identity are qualified before I/O; one-attempt native clients
ignore configured endpoint overrides. Keys remain local to each invocation. The new bounded
`CoverLetterCleanupClient` sends the existing private v1 fence contract with exact echo/version
validation. Local deadlines and disposed receipts never settle another writer or authorize purge.

`build:lambda:response-maintenance` emits a separate internet-maintenance artifact family and
checks its actual exported default-off handler. The emitted bundle guard excludes SQL, S3,
rendering and generation code. Reviewed IAM, maintained scheduling, retention/abandonment/drain
and accountable/deployed acceptance remain open. Nothing is deployed or activated. See
[local evidence](../../../docs/product/delivery/evidence/d3-response-maintenance-bootstrap-2026-10-04.md).

`createCoverLetterPersistence` in the private runtime export owns three separate raw one-connection
pools for document persistence, work and candidate leases. Final-document settlement refuses
other purposes before SQL; the lease receives only its frozen lease method. Native codec and
connected activity evidence is in [D3-068](../../../docs/product/delivery/evidence/d3-preparation-activity-bootstrap-2026-10-04.md).

The dedicated `cover-letter-export` entrypoint reads exact saved IDs/versions under an active
candidate lease, checks metadata and pinned object/canonical hashes, and returns only paragraph
text/citations. It never selects a latest same-hash draft or regenerates missing bytes.
The native factory exposes a frozen read port, owns one Date/JSON pool and fixed one-attempt S3.
It defaults off, rechecks activation around reads, and never exports object/work/provider identities.
See [D3-072 evidence](../../../docs/product/delivery/evidence/d3-cover-letter-export-content-2026-10-04.md).


## One-off generated material memory replacement (D3-064)

Accepted ADR-038 supersedes the saved generated-content behavior described in historical source
sections above. Those S3 draft/provider-slot creation, saved-result recovery and content-export
paths cannot activate under the new policy. Original uploaded/normalized resumes retain their
separate policy.

`temporary-materials.ts` owns bounded process-local encoded bytes and active copies, with exact
owner/application/generation/hash/completion references, non-renewable 1,800-second deadlines,
idle timers, cancellation scopes, staged publication and post-async expiry checks. Limits are
16 MiB managed buffers, 128 entries, 2 MiB per material and 16 borrows; only lower limits are
accepted. Generic material kinds include cover letters and tailored resumes; the typed resume
content integration remains unfinished.

`temporary-cover-letter.ts` replaces generated cover-letter finalization, preview, file and
binding reads with memory-only ports and both production format checks. It requires original
completion authority and defaults off. The supplied completion timestamp must be the original
actor's generation-completion time, not reservation/verification/read/retry time. Missing or
already-consumed authority refuses reconstruction; no SQL/S3/provider/export capability reaches
the content store. Metadata-only read replay can use an available exact reference before expiry.
The original completion authority now has a default-off native SQL/private metadata RPC (below);
generated-content routing and transport still need implementation.

These modules are source-only and uncomposed. Their returned references must bind future packet
approval and final ATS handoff; a hash alone cannot identify a regenerated same-text draft.
Content-bearing HTTP responses must be no-store, and clients/actor owners must release their
copies at expiry or sooner on logout, cancellation and confirmed submission. Timers and aborts
clear managed buffers/references but do not prove arbitrary string erasure or remote/native worker
quiescence. No restart, renderer failure or cleanup timeout permits restoring a saved draft or
redispatching an ambiguous submission. Native/provider, resume, packet, lifecycle and browser
acceptance remain mandatory. See [source evidence](../../../docs/product/delivery/evidence/d3-one-off-memory-runtime-2026-10-04.md).


## Native original-completion metadata (D3-064)

`0010_temporary_material_completion.sql` adds only four nullable scalar columns on the existing
Documents reservation: original work ID, content hash, completion milliseconds and expiry
milliseconds. Legacy rows remain NULL, without backfill or object-retention approval. The tuple
is immutable and the expiry is exactly completion plus 1,800,000 milliseconds. First completion
requires the active owner and matching already-started original provider work, no original failure,
no previous final writer, a nonfuture original completion and an unexpired fixed lifetime.

`PostgresTemporaryMaterialCompletionStore` serializes Identity -> Documents reservation -> original
work and admits one original completion. Exact replay reports `already_completed`; conflicting
hash/time/owner/application/version refuses. This is metadata admission, not content recovery or
writer settlement. The trusted original generator supplies completion time; SQL cannot independently
observe a model finishing. New final-document writer grants are refused for these reservations;
revoked tombstones remain allowed so existing cleanup fencing can complete. Running writers still
block deletion. No provider response/object inventory is discarded or certified absent here.

Private v1 `claim_original_completion` carries only the closed work/material references and echoes
all bindings. The client binds one original work, requires a numeric us-east-2 Lambda version,
status 200/exact ExecutedVersion, canonical bounded UTF-8 JSON, no logs/function errors and one SDK
attempt. Lost responses return unavailable without refreshing expiry. The lazy native bootstrap
owns one native-codec SQL connection and stays off under `TEMPORARY_MATERIAL_COMPLETION_ENABLED`.
Exact target matching does not authenticate its caller; reviewed sender IAM is required before use.
The emitted control/client exclude content memory, rendering, S3, model generation and work issuance
or settlement implementations; check with `node --test scripts/tests/temporary-material-completion-bundle.test.mjs`
after a Documents build. No artifact family, cloud configuration, public route or UI is activated.

Roll out Documents migration 0010 and the current 62-migration/84-relation manifest before this
control code. Historical release evidence remains bound to its original inventory; old native
controllers cannot be treated as current restore evidence. Existing NULL reservations retain
compatibility, but content in historical saved-draft paths still violates ADR-038 and cannot be
activated. A code rollback cannot renew or remove a recorded completion; memory loss requires new
preparation and fresh review. Resume integration, memory routing/no-store, packet/ATS expiry,
client lifecycle, native worker drain and approved provider retention remain open. See
[local evidence](../../../docs/product/delivery/evidence/d3-original-material-completion-2026-10-04.md).

## Narrow temporary cover-letter reader (2026-10-05, source-only)

`TemporaryCoverLetterService.reader()` returns a frozen process-local availability/preview/file
capability with explicit owner/application/exact-reference checks, never completion, model, SQL,
object recovery or generation methods. Known absent memory returns `null`; evidence/owner outage
is an availability failure. Content responses carry a process-local synchronous memory lease
check that Applications uses after its final SQL read and during HTTP serialization. That callback
is never durable or public metadata. Completion remains default-off and native original authority
is required. Native session host/transport, all-copy idle/cancel/logout/confirmed-submit disposal,
client lifecycle and approved provider retention are still required before activation.

The synchronous memory guard is availability authority, not a held borrowed content lease.
Bounded outgoing native content leases and all-copy disposal remain activation requirements.

## Held temporary responses and terminal sealing (2026-10-05, source-only)

Temporary cover-letter reads now hold an accounted memory lease through the immediate consumer.
A 512 KiB outgoing reservation is charged before rendering, within existing store/borrow limits.
The response exposes process-local `signal`, `revalidate` and idempotent `release` capabilities;
callers must release when finished. Revalidation uses the same held copy and scalar context hashes,
with no second managed borrow. Idle original expiry, caller abort or application scope disposal
clears controlled returned paragraphs/file content. Unknown renderer completion retains capacity
until the callback actually finishes; cancellation is not settlement.

The narrow adapter also exposes `discardApplication`, which seals a terminal scope and clears
controlled material. New generations in that scope cannot publish in this process. Seals are bounded
and capacity exhaustion closes memory. `discarded` is local copy/fence acknowledgement, not a
provider, remote writer or physical native-host purge certificate. Host/transport/client/ATS and
provider gates remain. Earlier source evidence described an availability-only guard; this extension
adds a held borrow, with no durable/public capability or production composition.

The default-off `OriginalCoverLetterGenerationActor` replaces stored provider slots for original
cover-letter generation: private owner evidence, memory-only canonical request identity, consume
an existing native grant, one foreground SDK call, positive scalar settlement, then original
completion into bounded memory. It exposes no issue/renew/object/SQL/recovery capability. Generated
paragraphs actively expire while control acknowledgements wait; cancellation during completion
or just after publication discards the exact material. A pending original provider promise keeps
this actor's admission occupied even after SDK timeout. The private issuer, process-wide bounded
session host, authenticated ports and physical drain are still uncomposed; no activation or
provider-retention/all-copy purge claim follows. [Local evidence](../../../docs/product/delivery/evidence/d3-original-memory-generation-2026-10-05.md).

The private `./native-memory-session` source factory pins one candidate/application/generation
in one dedicated Linux process and connects original SDK completion to a one-time kernel expiry.
It defaults off, refuses another allocation/worker-thread use, and exposes no SQL/object/issuer
or listener capability. Its disposal method requests native retirement without returning a death
acknowledgement; a separate trusted process/task observer is required. [Proposed ADR-040](../../../docs/adr/040-native-temporary-material-processes.md)
records native image/lifecycle, transport, authenticated owner ports and release gates. Do not
load its kernel module into a shared API/worker or Lambda. This is not an enabled candidate flow.

The private `./native-memory-transport` export adds a default-off dedicated Linux TLS 1.3 read
listener for one native session's immutable application/generation. It requires exact OIDC
identity/audience/scope/expiration, repeats private scalar packet/source/token checks, preserves
original expiry, holds bounded admission through real pending calls and clears controlled output
after transport completion/abort. Only the trusted launcher can bind the listener; it has no SQL,
object, model or process-death acknowledgement capability. Remote owner authentication, launch,
registry, managed routing/stop and full client/ATS acceptance remain gates. See
[transport evidence](../../../docs/product/delivery/evidence/d3-native-memory-transport-2026-10-05.md).

The private `./native-read-authorization-client` entrypoint checks the fixed original material
through the normal authenticated Gateway scalar endpoint using the current request token only
in a header. It pins HTTPS origin, refuses redirects, retries and body-bearing responses, checks
strict original metadata and clears bounded response bytes. The native listener supplies its
verified token and emits direct existing preview/file JSON. The independent Gateway capability
stays default-off; no generated body enters this metadata control path. See
[authorization evidence](../../../docs/product/delivery/evidence/d3-native-read-authorization-2026-10-05.md).

The private `./native-task-retirement` entrypoint runs only in a trusted control process. It pins
one immutable owner/application/generation/allocation and task, sends at most one signed ECS stop
request and requires a fresh exact task/container STOPPED description before a scalar receipt.
Timeout, abort, missing tasks and stop replies are not proof. It defaults off and has no generated
content, SQL, launch/list or provider-settlement port. Complete registry/sealed launch admission,
IAM and real managed-task conformance remain prerequisites for application-wide disposal. See
[retirement evidence](../../../docs/product/delivery/evidence/d3-native-task-retirement-2026-10-05.md).

The private `./native-material-registry` and `./native-material-disposal` sources add durable
pending/bound/retired allocation metadata and sealed original launch admission. Applications
supplies same-transaction owner/status locking. Unknown launch remains unresolved; late capture
can bind after sealing. New generation requires an explicit fresh epoch and original work issued
after sealing. Disposal commits the seal, awaits exact ECS proof outside SQL, persists that proof,
then confirms the current sealed epoch. No task receipt settles provider work. Migration 0011,
optional technical export and restore boundaries preserve deletion blockers and revoked cleanup
fences. The private launcher/RPC/IAM/image/routing/managed-task and full client/ATS/provider gates
remain; nothing is activated. [Registry evidence](../../../docs/product/delivery/evidence/d3-native-material-registry-2026-10-05.md).

The private `./native-evidence-binding` validator and registry `checkEvidenceAdmission` pin
original task/work/current unsealed admission before owner evidence reads. Admission locks end
before reading facts/job; it never consumes work or proves task liveness. Existing original
work-claim guards remain final authority. See [evidence](../../../docs/product/delivery/evidence/d3-native-evidence-admission-2026-10-06.md).
