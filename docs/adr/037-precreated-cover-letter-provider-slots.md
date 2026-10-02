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

The maintenance role currently declares document `s3:DeleteObjectVersion`, not the
`s3:DeleteObject` authority required to create a delete marker. A narrowly scoped IAM/boundary
change and its guarded plan need separate owner review before deploying generation-slot cleanup;
no such infrastructure change is included. Isolated provider permissions and remote-dispatch
quiescence are also unfinished. No production provider runtime, IAM, Terraform, activation or deployed
privacy acceptance is included. This proposal neither supersedes
accepted deletion requirements nor represents accountable security/privacy approval.

## Consequences

The primitive fails closed on missing or conflicting objects and admits at most one replacement
of a specific placeholder while that placeholder remains current. Historical version reads never
independently grant dispatch. Private initialization and isolated replacement require distinct
capabilities. Broader deletion/runtime changes need their own tests and guarded rollout before use.
The proposed protocol remains incomplete until every prerequisite above is proven.

## Alternatives

- Conditional creation by the provider: rejected because deletion markers allow recreation.
- Caller cancellation as remote cancellation: rejected because it does not prove remote quiescence.
- Unconditional replacement or retry on conflict: rejected because it can restore deleted bytes
  or grant duplicate external effects.
- Direct model access in the private database runtime: rejected by ADR-016's trust boundary.

S3 behavior references: [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
and [versioning workflows](https://docs.aws.amazon.com/AmazonS3/latest/userguide/versioning-workflows.html).
Provider policy reference: [enforcing conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html).
