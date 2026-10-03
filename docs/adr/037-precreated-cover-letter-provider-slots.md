# ADR-037: Precreated cover-letter provider slots

Status: Proposed
Date: 2026-10-02

## Context

[ADR-016](016-scale-to-zero-application-runtime.md) separates private database activities from
internet-facing provider activities. Candidate prompts and results must stay in owned encrypted
Documents objects, not Lambda invocation bodies or durable checkpoints. Documents reserves the
document identity before any object write so candidate deletion can inventory every generation slot.

A timeout on private invocation does not stop the remote function. Conditional creation using
`If-None-Match: *` is insufficient: an S3 current delete marker allows creation again. Removing
current versions during a version purge can also expose an older authorization placeholder.
Transport correctness is not evidence that dispatch, quarantine or deletion is safe end to end.

## Decision

Propose three fixed slots under `normalized/<documentId>/generation/`: immutable request,
dispatch and result. The private owner precreates dispatch as `issued` and result as `pending`.
The isolated provider must have no creation capability. Its writes may only conditionally replace
an owned placeholder using its exact current ETag: `issued` to `claimed`, or `pending` to `ready`.
References pin version, ETag, SHA-256 and size. Every transition preserves document and request
identity and uses the configured KMS key. A duplicate/conflict or missing current slot grants no
dispatch and has no unconditional or create-on-missing fallback. Ambiguous writes cannot grant a
new model call; recovery must inspect the original immutable identity.

Before composition or activation, implement and test all of the following:

- Provider capability/IAM isolation, including prohibition of object creation and deletion.
- A deletion fence kept current until all historical versions are removed, preventing older
  issued/pending versions becoming current during purge. Final deletion must prove no versions or
  markers remain and no authorized writer can recreate them.
- Bounded dispatch authorization and privacy quiescence: quarantine refuses new authorizations,
  and deletion drains or fences previously authorized remote work even after a private RPC abort.
  ETag transitions alone do not prevent an already claimed remote model call after quarantine.
- One-dispatch provider execution, partial-result recovery without a new model call, and transient
  prompt/result retention and expiry for failed or abandoned operations.

The strict contract, conditional-transition transport and generation-slot purge fence have
offline source tests today. The Workflows purge adds current delete markers for observed fixed
generation slots, verifies their current identities, removes historical versions while preserving
the fences, then proves only fences remain before removing them. Exact-key cleanup defers these
slots to the fenced sweep. Failed acknowledgements, missing/noncurrent fences or surviving history
refuse completion; retry establishes a new current fence before removing the old one.
Six connected PostgreSQL cases include quarantine/row retention on incomplete fenced cleanup and
successful retry, with synthetic data and offline S3. Ordinary resume purge has no new fence calls.

The source-only isolated handler now exposes a frozen transition-only capability without object
creation, defaults off before I/O, and requires a positive dispatch-claim receipt before one
ModelGateway call. It checks the original consent and approved model identity again before that
call. Canonical encrypted results retain strict model provenance and original output size;
invocation outputs remain reference-only. Ambiguous claim/result writes return `in_progress`
so the private caller can retry recovery without prematurely recording terminal product failure.
Duplicates can recover an original ready result after consent expiry, but must verify the original
dispatch time, request binding and provenance. A claimed pending slot never grants another call.
Twenty-five handler tests compose real object transport with offline S3 and a fake model.
The private read-only recovery primitive now verifies SQL-owned reservation identity, encrypted
request/result bindings, the freshly reconstructed prompt and original authorized dispatch time
before shared pure grounding. Twenty-three offline cases cover expired-original recovery,
missing/pending slots, changed evidence/ownership, corruption and unsupported claims. It has no
provider or write capability. A separate private recovery service now reads the SQL-owned
reservation without creating work, reloads owned evidence, reads/grounds under an active-candidate
lease and shares PDF/DOCX production-parser checks with ordinary generation before immutable
completion. Completion independently checks the candidate lease. Seventeen offline service cases
and two new real PostgreSQL cases cover finalization/replay, ownership and quarantine; there is
no model, Invoke or reservation capability in this service. The private initializer/Invoke and
production activity/handler bootstrap remain unfinished. The local handling deadline is not a
privacy-quiescence protocol.

The source-only private initializer now defaults off, reserves the owned SQL document identity
before object writes, and creates request/result/dispatch placeholders in that order under the
active-candidate lease. Only the first committed reservation winner can create them. Replays only
read/pin existing slots; no missing-slot recreation or partial-create continuation grants fresh
dispatch. Twenty-one offline cases and one real PostgreSQL case prove ordering, first-writer
concurrency, lost-ACK/removed-slot replay and consent/kill-switch/quarantine checks. Partial
initialization may need bounded operation compensation and a new explicitly approved operation,
not creation on replay. This initializer does not invoke a provider. Late private S3 creation after
a local abort is still an unresolved quiescence risk; no runtime composition/activation is added.

The source-only private Invoke adapter now defaults off and pins an exact numeric function version.
It sends strict document/reference metadata only, requires single-attempt SDK configuration, and
requests neither log tails nor asynchronous invocation. Bounded original-response validation rejects
unexpected versions, function errors, logs and content-bearing outputs. Ambiguous remote outcomes
remain in progress for original-result recovery, never fresh model dispatch. Sixty offline cases
include real installed SDK serialization and one HTTP attempt on a server error. Local cancellation
is not remote quiescence; production composition and bounded authorization/retention remain open.

The source-only candidate object purge now requires positive confirmation from an injected private
quiescence authority before cleaning any inventoried cover-letter reservation, even when no S3
object/version exists. Observed generation slots or final draft keys also require confirmation
before prefix cleanup. Missing, false, malformed, failed or stalled proof refuses cleanup with a
fixed error; elapsed local time never becomes proof. Ordinary resume-only cleanup is unchanged.
Eight new offline gate cases and the six connected PostgreSQL deletion/restore cases pass: pending
letter rows/quarantine survive missing proof, while an explicit synthetic confirmed retry completes.
The confirmation fixture is not a production authority. A persisted non-renewable private-write/
provider drain implementation and deployed IAM/runtime evidence still block activation.

AWS documents that bucket policy can require `s3:if-match` on provider writes. The reviewed future
policy must restrict the exact generation replacement slots and must not copy the documentation's
multipart exemption as broad creation authority. This does not restrict the separate private
initializer's `If-None-Match` writes or establish their drain. No IAM/Terraform change is made here.

The private owned-evidence factory now composes existing Applications, Jobs and Profile reads
under the active-candidate lease; it validates owned application identity before candidate values,
excludes restricted facts, snapshots the complete posting/graph and rechecks expiry/kill switches.
Twenty-one offline and three real PostgreSQL cases pass. Integration identified incompatible
owner database codecs: supported owner-specific one-connection clients plus a distinct lease pool
are required, not nested owner reads on a shared one-connection pool. Four Profile projection cases
preserve evidence/value detachment, and the Gateway delegates to the same projection without a wire
change. Authentication is simulated. The factory stays default-off/uncomposed; no production
authorization/drain, provider/IAM, retention or handler bootstrap is proven by these reads.

The maintenance role currently declares document `s3:DeleteObjectVersion`, not the
`s3:DeleteObject` authority required to create a delete marker. A narrowly scoped IAM/boundary
change and its guarded plan need separate owner review before deploying generation-slot cleanup;
no such infrastructure change is included. Isolated provider permissions and remote-dispatch
quiescence are also unfinished. No production provider runtime, IAM, Terraform, activation or deployed
privacy acceptance is included. This proposal neither supersedes
accepted deletion requirements nor represents accountable security/privacy approval.

## Consequences

The private source-only preparation service now connects initialization, fixed-purpose original
provider issuance, one numeric-version Invoke and owned read-only recovery/finalization. Issuance
requires positively settled original slot work with matching owner, request digest and consent
under the same parent-row lock as issuance/cancellation. Only a fresh committed grant winner can
Invoke. Prior grants never authorize replay; ambiguous control/Invoke acknowledgements, cancellation
or a late response cannot renew authority or settle work. Recovery does not trust Invoke outcomes
as draft or settlement proof and permits original ready-result finalization after consent expiry.
Five connected PostgreSQL cases exercise actual source components with synthetic object/model/Lambda
ports, without seeding provider settlement. This is not authenticated production RPC, live provider
evidence or remote-quiescence proof. Runtime/IAM, failed-call settlement, transient retention,
read/export/restore and accountable acceptance remain unfinished; default-off posture is unchanged.

The final-document S3 transport now enforces explicit single-attempt policy per PUT and separates
positive original creation receipts from conditional-conflict recovery. A missing/ambiguous receipt
never becomes acknowledged from HEAD. Exact HEAD/GET versions, bounded content/digest, detached
input and locally bounded I/O are verified offline, including installed-SDK success/server-error
responses. Local abort does not prove remote work stopped. The PostgreSQL final writer now requires
an original final-document claim before every PUT; a settled provider row supplies immutable request
and consent binding. It cannot steal an earlier unclaimed grant or renew expired/revoked work.
Completion is serialized before independent issuance without holding the parent row, then locks
and revalidates metadata. Original positive creation plus exact pinned read may settle; conditional
conflict, missing receipt, failed read, lost ACK and read-only replay never manufacture settlement.
SQL rollback after original settlement can recover existing bytes without another PUT. Missing or
deleted objects cannot be recreated by replay. Inputs/control references/version receipts are
detached across asynchronous work. Connected tests use synthetic objects and in-process SQL controls,
not authenticated production RPC or remote-stopped proof. Activation remains forbidden pending the
remaining runtime, IAM, retention, trusted remote settlement and accountable acceptance prerequisites.

The isolated handler now requires a fixed-purpose private control claim before any external effect.
It consumes an existing `provider_dispatch` authorization, never issues/renews work or selects a
candidate owner. Documents resolves the stored owner and reuses its atomic active-candidate,
immutable-binding and server-time claim. The settlement capability is provider-phase-only. Only
the original positive dispatch/completed-model/result acknowledgements settle that phase; replay,
object presence, lost acknowledgements or a local timeout do not. The compiled isolated handler
imports no database runtime. Connected SQL/offline object/model evidence is not authenticated
remote RPC or live provider/IAM evidence. Failed-call remote settlement,
retention and full runtime/drain composition remain unfinished, so the proposal stays incomplete.

The private initializer now enforces the Documents ledger: a fresh exact-bound `private_slots`
authorization must be positively claimed before any creation. It never races committed control
results against local cancellation. The S3 port requires an explicit single-attempt policy and
positive one-attempt HTTP 200 write metadata before returning an acknowledged pinned version.
Settlement follows only all three original acknowledged/pinned writes; partial, conflicting,
aborted or lost-acknowledgement paths remain running. Read-only replay never settles them, even
when every original slot is visible. Offline installed-SDK and connected PostgreSQL tests cover
these boundaries. This is initializer enforcement, not production provider/final-document composition,
trusted remote quiescence, live IAM/KMS or accountable approval. The proposal remains incomplete.

The proposed private Documents control ledger now has a forward-only `0007` migration. Three
fixed purposes (`private_slots`, `provider_dispatch`, `final_document`) bind the same original
request digest/consent per document. Each purpose can be issued and claimed once, using server time
and a non-renewable admission window of at most 90 seconds. Slot/model authority also expires at
original consent expiry; finalization requires original provider settlement and may occur later
without new model authority. Replay never renews identity, deadline or terminal state. Cancellation
can permanently fence not-yet-issued phases during quarantine, but cannot close running work.
Expired issued records remain unresolved until explicit cancellation, and running records require
trusted positive settlement regardless of deadline. SQL triggers enforce binding, admission,
irreversible transitions and unresolved-deletion refusal. Terminal records can only disappear with
their owning document, preventing delete-and-reissue. The ledger is private/default-off and not
composed into production: all actors, positive remote settlement, IAM and restore enforcement
remain prerequisites. A settled ledger alone does not satisfy the existing quiescence port.

The primitive fails closed on missing or conflicting objects and admits at most one replacement
of a specific placeholder while that placeholder remains current. Historical version reads never
independently grant dispatch. Private initialization and isolated replacement require distinct
capabilities. Broader deletion/runtime changes need their own tests and guarded rollout before use.
The proposed protocol remains incomplete until every prerequisite above is proven.

## Private cleanup admission fence (2026-10-03 source checkpoint)

The owner approved source-only private cleanup control, with public APIs, frontend, Terraform
and deployment excluded. A separate maintenance-only version-one handler consumes an exact
existing work reference, resolves its owner in Documents and permanently fences unclaimed and
not-yet-issued phases using the existing ledger. It defaults off, pins the numeric invoked target
and does not expand the isolated provider's claim/positive-settlement capability. Production
caller authentication, maintenance-only IAM and runtime composition are not implemented here.

Cleanup never changes running work to settled and cannot create finalization authority. Concurrent
claim/cancellation leaves either revoked admission or unresolved running work. Original positive
settlement may drain old work after quarantine, but the final-phase fence still prevents new writes.
Lost acknowledgements can replay the same non-renewable fence without extending consent/deadlines.
Unknown or conflicting references fail closed without retroactively tracking the reservation.
The receipt deliberately says `ledger_terminal`, not quiescent or deleted: ledger-only terminal
state cannot satisfy the Workflows generation-quiescence port. SQL reservation/object inventory
is retained; no object or row deletion is performed. Ambiguous running actors still need trusted
positive stopping/completion evidence, and transient-retention enforcement remains unfinished.
No new persisted state or migration is needed for this admission-fence step. Thirty-one offline
boundary cases and 16 new real PostgreSQL cases pass, including quarantine, late settlement,
lost acknowledgement and claim/cancellation races. This proposal remains incomplete/default-dark.

## Original completed response rejected by output validation (2026-10-03 source checkpoint)

The owner approved source-only internal gateway completion receipts and private provider-phase
cleanup. An error code cannot distinguish a local refusal from a provider that already received
the request. Only original provider-port fulfillment can yield a completion receipt; thrown errors,
lost acknowledgements, aborts and timeouts remain unresolved even if a late response arrives.
The receipt captures original model/prompt provenance and contains no rejected candidate text.

After validating that receipt and before any result write, the isolated actor may send the new
strict private v1 `settle_rejected` operation with its exact original provider reference. Documents
permanently fences unclaimed/not-yet-issued phases before settling the original provider phase.
Thus rejected completion cannot create finalization authority. Quarantine may drain original
completed work but grants no new effects. Replay never renews authority; issued/revoked or unbound
references are refused. A lost closure response stays unresolved to the caller; failure between
fence and settlement retains running work and reservation inventory with finalization fenced.
Older compositions refuse the operation; separately reviewed rollout must compose matching
private control first. The default-off source remains unactivated. Ninety-five real PostgreSQL
ledger cases and offline gateway/control/actor tests pass, not live-provider or remote-quiescence
evidence. No migration, public API, frontend, guard/Terraform, cloud/model call or deployment is
included. This proposed ADR still requires trusted failed-call stop evidence, runtime/IAM,
retention and accountable privacy/production proof before activation.

The actual adapter audit then reproduced a completed oversized response throwing at the adapter's
character check before reaching the gateway receipt path. An optional internal lifecycle port now
preserves original byte-bounded completed response fulfillment until gateway character/JSON
validation; ordinary adapter `complete` retains its previous character refusal. Exactly one port
is dispatched, with no fallback after error. Actual-adapter offline HTTP is included in isolated
and connected PostgreSQL rejection tests. Incomplete, malformed and lost responses remain pending;
no endpoint/model/request setting or live-provider behavior is activated.

Current official documentation limits the response-cancel endpoint to background responses and
describes synchronous cancellation through connection termination. It does not establish that a
local aborted fetch supplies an independently acknowledged terminal receipt for this protocol.
Background execution also temporarily retains data for polling, even with `store=false`; it is
not enabled by this approval. A different provider lifecycle/retention design still needs separate
review. [Background mode](https://developers.openai.com/api/docs/guides/background),
[cancel endpoint](https://developers.openai.com/api/reference/go/resources/beta/subresources/responses/methods/cancel),
[data controls](https://developers.openai.com/api/docs/guides/your-data).

## Original gateway non-dispatch (2026-10-03 source checkpoint)

The owner approved source-only internal non-dispatch receipts and matching private cleanup.
Only the gateway's known pre-provider refusal branches return `not_dispatched`, with original
model/prompt provenance and a fixed refusal code, not candidate text. Ordinary `generate`
preserves its refusal contract. Caught exceptions, including provider-thrown identical codes,
never become receipts; aborts, lost responses and timeouts remain unresolved.

After its original dispatch-slot replacement acknowledgement, the isolated actor can consume
that original receipt and call private v1 `settle_undispatched` with the exact provider grant.
Documents permanently fences future phases before settling that original running phase, using
the same fail-closed fence protocol as rejected completion. No result write follows; replay
cannot dispatch again. Wrong bindings, missing older capabilities, lost closure acknowledgements
and expired local handling deadlines refuse closure. No object/row purge or production-quiescence
certificate is produced. Matching control must precede actor rollout, with older handlers refusing
the additive operation. Runtime/IAM, transient retention, trusted failed-call stopping evidence
and accountable production acceptance remain blocking. No migration, public API/frontend,
guard/Terraform, cloud/model call, deployment or activation is included.

## Background response stopping and disposal (2026-10-03 source work)

The owner separately approved source-only background response lifecycle/retention work and its
temporary provider-state tradeoff. OpenAI's current documentation describes cancellation only
for background responses and roughly ten minutes of temporary polling state even with
`store:false`. This does not establish a maximum retention period or Zero Data Retention.
The initial known-reference cleanup transport verifies original response id/time/model and
the background/no-store/no-tools/no-linked-response boundary before cancellation. Positive
terminal status permits an exact response deletion request; a positive id-bound deletion
acknowledgement produces a content-free receipt. This is not deletion of abuse-monitoring copies.
Lost acknowledgements, missing/expired identities, HTTP errors and local deadlines remain
unresolved. The adapter never creates or generates a response, retries, settles SQL work or
authorizes platform purge. Its 59 new offline cases and all 170 AI SDK cases pass, as does the
full maintained repository verifier. Complete private runtime composition remains pending;
the separate live dependency audit still fails without waiver. Existing foreground generation
remains unchanged.

Original background creation through the gateway, immutable durable response/work capture,
private-writer drain, disposal reconciliation and authenticated runtime/IAM remain required.
In particular, an unacknowledged creation with no response identity cannot be cancelled by id,
and cannot be treated as stopped merely because temporary polling state later expires.
The existing generation-quiescence port must remain uncomposed until the full proof is available.
No migration, guard/Terraform, cloud/model call, deployment or activation is included.

References: [background mode](https://developers.openai.com/api/docs/guides/background),
[cancel response](https://developers.openai.com/api/reference/typescript/resources/responses/methods/cancel),
[delete response](https://developers.openai.com/api/reference/resources/responses/methods/delete).

## Durable response inventory (2026-10-03 source work)

The owner directed engineering to proceed with the recommended source-only Documents migration,
private ledger API and strict inventory/guard updates. `0008` reserves metadata-only response
inventory against the exact original running provider grant, before background creation. Only
the first committed reservation may continue that original dispatch; replay cannot renew it.
Creation id/time and positive terminal deletion acknowledgements are immutable and replayable,
including after original consent expiry or quarantine. Unknown original ids remain unresolved.
Neither capture nor disposal settles work; unresolved inventory prevents cascaded row deletion.

The source manifest advances to 58 checksum-bound migrations and 84 relations across seven
existing owners. Historical inventories remain verified only against their own source, with
current-source rejection tests retained. Migration/consumer rollout must precede compatible
actor composition, all while default-dark; no guessed response-id backfill or downgrade that
erases unfinished inventory. Gateway integration, maintained reconciliation, private writer
drain, runtime/IAM, live/provider/accountable proof and deployed acceptance remain unfinished.
No public API/frontend, Terraform, cloud/model call, activation or deployment is included.

## Source-only original background capture (2026-10-03)

The owner directed engineering to proceed with recommendations. The private original actor now
has an opt-in reserve/capture capability, selecting a separate model-gateway/provider port without
foreground fallback. Existing foreground behavior stays unchanged. Gateway disclosure/input
checks precede reservation; the actor rechecks original consent and its handling deadline after
the committed reserve. One background create follows only its first winner. Exact response
id/time capture must commit before polling or output acceptance, including immediate completion.
GETs preserve the original id/time/model/background/no-store/no-tools/no-linkage binding and are
paced, byte-bounded and capped. Character/JSON rejection still follows original completion.

Unknown create/capture acknowledgements remain unresolved and never authorize redispatch,
settlement or purge. This does not compose private capture RPC, caller IAM, maintained disposal,
writer drain or platform quiescence. The protocol remains Proposed and default-off, with no live
provider, public API/frontend, migration, Terraform, deployment or activation. Official background
documentation and the selected GPT-6 Luna model page were inspected; offline tests do not prove
account/model availability or exact retention behavior.

## Source-only private original-response capture RPC (2026-10-03)

Source-only D3-048 adds a separate private original-response capture v1 boundary: the isolated
actor's exact-version single-attempt client invokes Documents-owned reserve/record-creation
transactions with closed original work and response metadata only. Default-off client/handler
tests cover bounded canonical acknowledgements, strict binding, SDK retry refusal and lost ACKs;
connected SQL tests prove committed inventory, immutable replay and original quarantine drain.
No read, disposal, settlement, renewal, generation or purge capability is supplied. Target matching
is not caller authentication. Reviewed provider-role IAM, runtime composition, maintained disposal,
writer drain and deployed acceptance remain prerequisites; this ADR remains Proposed.

## Source-only abandoned response disposal reconciliation (2026-10-03)

Source-only D3-049 adds FAILED/ABANDONED work response reconciliation, not disposal during ordinary
generation. The private caller must commit the existing permanent admission fence before exact
inventory read and provider cleanup. Only a positive original terminal/deletion receipt may reach
Documents disposal persistence and durable readback. Unknown identities, lost ACKs, 404 and local
deadlines remain unresolved; committed disposal replay skips provider I/O. This does not settle
running private writers, certify quiescence, admit finalization or grant platform purge. Maintained
scheduling, authenticated runtime/IAM, successful-generation disposal and writer drain remain
unfinished/default-off. The proposed protocol and deployment posture are unchanged.

## Alternatives

### Source-only private response-capture Lambda bootstrap (2026-10-03)

D3-052 composes the unchanged capture RPC with only original Documents reservation and
creation-acknowledgement controls. An independent default-off gate and the shared D3-051 lazy
bootstrap enforce numeric invoked-target binding, qualified same-account managed-secret input,
bounded read-only initialization and warm identity pinning. A native one-connection pool keeps
ledger timestamp semantics unchanged. Capture never grants read/disposal, work settlement,
renewal, generation, object, renderer, Invoke or purge capabilities. Original transactions are
awaited without retries or local timeout settlement. Target matching is not caller authentication;
runtime/IAM, artifact/build guards, deployment/activation and complete writer/provider quiescence
remain unfinished. No public API, provider/capture contract, migration, guard/Terraform or live
cloud/model change is included; the protocol remains Proposed.

### Source-only private provider-work Lambda bootstrap (2026-10-03)

D3-051 adds a lazy default-off entrypoint for the existing provider-work RPC only. Exact trusted
numeric-version target matching and same-account qualified secret/runtime-session validation
precede secret/database I/O. Managed-secret resolution reuses the existing helper; a native
one-connection PostgreSQL pool retains the ledger's Date timestamps instead of the ORM helper's
string timestamp parsers. Single-flight initialization cannot rebind warm target/secret identity. Input
snapshots and gate rechecks preserve the existing original control semantics. Read-only setup
failure may retry, but original ledger effects are awaited without retry or timeout settlement.
This is not caller authentication, quiescence proof, artifact publication or deployment.
Reviewed exact-version caller IAM, database/secret permissions and build/guard wiring remain
required and unimplemented here. Public APIs, provider/capture/maintenance contracts, retention
policy and deployment posture are unchanged; no cloud/model call or activation occurs.

### Source-only recovered-draft admission hardening (2026-10-03)

D3-050 retains `PostgresCoverLetterStore.complete` as the sole final-document claim and
positive original settlement owner. The private recovery service passes the reconstructed
original request digest, rather than claiming twice. Pending recovery is explicitly default-off;
ready replay remains read-only. Exact data-only grant references must match the document, purpose
and request digest. A local admission deadline cannot permit a new object write after a late
claim acknowledgement and cannot certify settlement. Only original positive object creation
plus exact pinned read can settle. Read-only recovery after lost object/settlement ACK may
complete metadata without retrying writes or settling uncertain work. This is private source
hardening, not activation, runtime/IAM enforcement or provider-wide quiescence evidence.

The owner approved the source-only private provider-control RPC on 2026-10-02. It exposes claim
and positive provider settlement only, with strict identifier/reference-only version-one envelopes,
fixed-purpose references and original grant/hash-bound acknowledgements. The isolated client pins
an exact numeric Lambda target, permits one SDK attempt and rejects ambiguous or malformed responses.
The private handler awaits original committed controls without a local deadline race. Neither port
issues or renews work, selects an owner, or settles private-slot/final-document phases. Invoked-target
matching is not caller authentication; production IAM and bootstrap are not implemented here.
Seven connected PostgreSQL pipeline cases use these ports with offline Lambda/model/object transport.
Lost claim ACKs leave running work without model dispatch. A lost positive settlement ACK permits
read-only recovery of an original already-settled result, not manufactured settlement or another call.
This is not deployment, live-provider or trusted failed-call quiescence evidence. The proposal remains
incomplete and default-dark.

- Conditional creation by the provider: rejected because deletion markers allow recreation.
- Caller cancellation as remote cancellation: rejected because it does not prove remote quiescence.
- Unconditional replacement or retry on conflict: rejected because it can restore deleted bytes
  or grant duplicate external effects.
- Direct model access in the private database runtime: rejected by ADR-016's trust boundary.

S3 behavior references: [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
and [versioning workflows](https://docs.aws.amazon.com/AmazonS3/latest/userguide/versioning-workflows.html).
Provider policy reference: [enforcing conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html).
