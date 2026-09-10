# Trust Service

Owns private UGC moderation decisions, contributor/source reputation evidence, contribution
withdrawal, takedown, and one bounded appeal. It must not rank candidates or directly mutate Jobs
catalog truth.

## Implemented boundary

Repository defaults remain dark. Controlled Greenhouse-only development has three separate
assignments: the dedicated workflow has only `case_opener`; the delegated agent has read, initial
decision, and takedown roles; the human has read and appeal roles. Case creation is not Trust
acceptance or catalog publication. See the [Phase 2 register](../../../docs/product/delivery/phase-2-extension-and-community.md)
for the exact release, assignment evidence, and outstanding acceptance.

The verified 2026-09-08 rollout deploys persistent opt-in development contributions without
contribution signing, remote policy fetching, expiry, or renewal. It preserves authentication,
exact client/provider/host scope, independent verification, Trust, and all three reviewer
assignments. Reviewer queue/evidence, pre-verification cancellation, terminal reconciliation,
the scheduler, and the alias-targeted SQS consumer are deployed. The receive-only Trust runtime
awaits batch records sequentially with one shared database connection per invocation; the SQS
mapping maximum and Lambda reservation remain aligned at two.

The historical 2026-09-08 `42b9686` release ran Jobs `0022`, verifying 42 migrations and 68 relations
across six owners and ten schemas at state 290 with Gateway/scheduled/Trust versions 55/17/13.
The September 10 coordinated development checkpoint used source
`2dd3aa21d2991bc97caebc3e90e785654eb9fb1e`; the Phase 2 register owns subsequent release updates.
On 2026-09-10, revision-51 migration ran exactly once with exit `0` and seven exact aggregate
success messages, verifying 44 migrations and 68 relations across six owners and ten schemas,
including Jobs `0023` and Trust `0004`. Resume Apply advanced state 295 to 296 at `00:50:58Z`;
maintained Verify and the `01:09:09Z` readback confirm resumed Gateway/scheduled/Trust versions
58/20/16, reservations 2/1/2, no active ECS compute, and a non-applyable plan with zero resource or
output changes. Historical cloud PITR covers 39 migrations, not this schema; current-schema cloud
recovery and the separate rights/export and dark-ingestion artifact releases remain open.

The `01:13:53Z` reviewer inspection passes the exact three agent scopes without role changes;
all three initial cases have fresh independent provider proof. One delegated initial decision
POST returned `503`. A separate `01:16:14Z` readback confirms all three remain `needs_review`,
version `1`; no successful decision, Trust acceptance, or publication is claimed.
The dependency/image blocker is closed under D2-034/D2-R13. The user confirms extension reload,
sign-in, and successful job addition, closing D2-033/D2-R11; that does not establish processing,
Trust acceptance, or publication. Exact human identity/MFA/scope checks and the user-confirmed
empty local appeal-queue read pass. Hosted reviewer and actual decision journeys remain open.

- A pure contribution-trust state machine starts every case in `needs_review`.
- Initial acceptance requires the fixed `independently_verified` reason. Rejection, withdrawal,
  takedown, appeal filing, and appeal resolution use closed reason-code sets.
- Forward migration `0004_accepted_independent_evidence` records the independent provider basis
  separately from reviewer/appeal evidence on cases and immutable events. New initial acceptance
  and appeal reversal require an exact, nonfuture provider proof no more than 24 hours old;
  historical missing bases stay null. Initial review binds the reviewed digest, while an appeal
  reversal retains its separate approved appeal digest. A nonaccepting transition cannot create
  or substitute a basis, and withdrawal clears the active basis. Jobs still rechecks freshness
  and the exact binding before publication. These changes are deployed in the resumed development
  release; successful decision and publication acceptance remain open.
- An adverse decision can receive at most one evidence-bound appeal. The appeal decision must be
  made by a reviewer other than the adverse-decision reviewer.
- Each case binds an injected policy version and appeal-window duration. The repository does **not**
  select a public, legal, or production appeal period. Tests use an explicitly synthetic 14-day
  fixture only.
- PostgreSQL owns a current case projection plus database-generated, append-only case events and
  append-only contributor/source reputation evidence.
- Every case transition now has one deterministic UUID and atomically appends an identifier-only
  `trust.contribution-decision.changed.v1` outbox record. Mutable lease/retry/acknowledgement state
  lives in a separate guarded delivery ledger; an ambiguous transport retry republishes the same
  event identifier.
- The reconciliation reader first exposes only decision and contribution identifiers, then
  requires the exact decision, contribution, and contributor-owner tuple before returning a
  fixed status, policy version, timestamp and internal evidence bindings. Reviewer event evidence
  and the independent provider-proof acceptance basis remain distinct. Neither enters the
  identifier-only signal/transport nudge; reviewer identity, reasons, source URL and contribution
  content also remain excluded.
- Owner reads require the exact contributor identifier and expose only the owner's case status and
  contributor signal codes. They omit reviewer identities, evidence digests, source signals, and
  other contributors. Source signals remain reviewer-internal.
- Trust stores only UUID references, fixed codes, timestamps, and SHA-256 evidence/source-key
  references. It does not store raw pages, free-form allegations, contact data, or public identity.
- The Trust schema has no foreign key, trigger, function, event, or write path into the Jobs schema.
  An `accepted` Trust result is internal eligibility evidence, not publication, activation,
  freshness extension, catalog removal, or source truth.
- A default-deny application-service boundary now separates authentication/authority, contribution
  eligibility and evidence, approved policy, and persistence. Contributor reads, withdrawals, and
  appeals are owner scoped. Case opening, initial decisions, takedowns, and appeal decisions require
  exact reviewer roles; verified-requester takedowns require an additional dedicated authority.
- Exact `case_reader` authority can read a 1–25-item initial-review or appeal queue, ordered by
  update time and case ID with a bounded filter-bound keyset continuation. It grants no decision
  role and supports no unrestricted text search. Readable evidence comes through a Jobs-owned
  exact contribution/owner port; Trust binds the returned verification digest to the case version
  and rechecks that version before returning. The projection contains complete bounded plaintext
  provider job fields, not contributor/reviewer identity or raw page HTML. Initial reviews can use
  the exact Jobs verification digest; takedown and appeal evidence remain separately approved.
- The application service accepts identifiers, fixed codes, versions, timestamps from its injected
  clock, and SHA-256 evidence references only. Missing ports deny or report dependency unavailability,
  and lower-level errors are projected to a fixed safe error taxonomy.
- Candidate status, withdrawal, and appeal operations resolve by the owner-known contribution UUID,
  not an undiscoverable internal case identifier. Cross-owner and missing contributions share the
  same absence result.
- Case opening derives one deterministic UUIDv8 from the contribution UUID. Persistence inserts on
  the unique contribution boundary and exact-reads a prior result, so a timeout-after-commit retry
  returns the original case without appending another event.
- Trust now implements its candidate-rights owner boundary. `trust.export_candidate_data(uuid)`
  returns one fixed `schemaVersion: 1` section containing only the exact contributor's cases, case
  events, and contributor reputation evidence. It omits contributor/reviewer identities, all source
  reputation, and every unrestricted value while retaining relevant identifiers, fixed codes,
  policy/version fields, timestamps, and candidate-linked evidence digests.
- `trust.delete_candidate_data(uuid, uuid)` first verifies the Profile-owned deletion request through
  `privacy.candidate_deletion_authorized`, establishes the exact transaction-local deletion context,
  then removes reputation evidence, case events, and cases in dependency order. The table triggers
  permit deletion only while `privacy.current_candidate_deletion_authorized` confirms that exact
  owner; ordinary updates and deletes remain denied. All candidate-rights and deletion-guard
  functions are revoked from `PUBLIC`.

## Package commands

```powershell
pnpm --filter @ai-job-apply/trust-service typecheck
pnpm --filter @ai-job-apply/trust-service test
pnpm --filter @ai-job-apply/profile-service... --filter @ai-job-apply/trust-service... build
$env:DATABASE_URL = "postgres://ai_job_apply:local_only@127.0.0.1:55432/ai_job_apply"
pnpm --filter @ai-job-apply/trust-service test:integration
```

The integration suites initialize the built Profile prerequisite through `0009`, apply and replay
Trust migrations through `0004_accepted_independent_evidence`, then prove owner isolation,
idempotent case opening,
different-reviewer enforcement at the SQL boundary, version conflicts, immutable audit/evidence,
private signal projection, candidate export redaction, no-public-execute function ACLs,
unauthorized and cross-owner deletion denial, transactional child-first candidate deletion, and
absence of Trust-to-Jobs database dependencies. Candidate deletion is the only context in which
the protected history may be removed.

The coordinated Jobs `0023`/Trust `0004` release quiesced contribution processing and reviewer
decisions, then verified compatible Gateway/worker artifacts and migrations before resuming.
The old singleton Jobs verification writer is not compatible with `0023`; do not roll it back
onto the new schema. Rollback must keep contributions disabled or use a compatible binary.

## Remaining authority and acceptance

- Gateway/API routes, the administrative review surface, durable decision signals, the Jobs-owned
  consumer, queue, scheduler, and deployment composition are implemented and deployed in controlled
  development. The workflow, delegated initial/takedown reviewer, and separate human appeal
  reviewer are bound; verified-requester takedown authority remains unassigned. Hosted reviewer
  and actual decision journeys still require acceptance.
- Trust never directly changes catalog truth. The Jobs-owned processor reconciles an authoritative
  Trust decision only after its own exact owner, verification, authorization, and lifecycle checks.
  An accepted case is therefore not itself proof of publication or website visibility.
- No aggregate reputation score, automatic sanction, reward, or contributor-facing ranking exists.
- Development has explicitly configured policy/timing values under the bounded Greenhouse
  exception. That does not establish accountable production policy, response SLA, retention,
  license, takedown-channel, requester-verification, or reviewer-organization approval.
- Controlled development and accepted Greenhouse fixture evidence exist. Production/store
  distribution, broader provider activation, human moderation acceptance, and final accountable
  security/privacy/product acceptance remain separate D2 gates.

The implemented orchestration boundary authenticates contributors and reviewers, authorizes exact
scopes, rechecks contribution authorization and independent verification, transports identifier-only
signals, and consumes Trust results idempotently through Jobs-owned commands. Repository tests and
a protected admin preview do not replace an authorized human moderation lifecycle against the
released backend.
