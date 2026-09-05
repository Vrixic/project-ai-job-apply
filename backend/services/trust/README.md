# Trust Service

Owns private UGC moderation decisions, contributor/source reputation evidence, contribution
withdrawal, takedown, and one bounded appeal. It must not rank candidates or directly mutate Jobs
catalog truth.

## Implemented boundary

Repository defaults remain dark. Controlled development enables only the dedicated workflow's
`case_opener` role; human decision roles are unassigned. Case creation is not Trust acceptance or
catalog publication. See the [Phase 2 register](../../../docs/product/delivery/phase-2-extension-and-community.md)
for the current deployment and reviewer/acceptance gates.

- A pure contribution-trust state machine starts every case in `needs_review`.
- Initial acceptance requires the fixed `independently_verified` reason. Rejection, withdrawal,
  takedown, appeal filing, and appeal resolution use closed reason-code sets.
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
  fixed status, policy version, and timestamp. Reviewer identity, evidence, reasons, source URL,
  and contribution content never enter the signal or transport nudge.
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
pnpm --filter @ai-job-apply/trust-service build
$env:DATABASE_URL = "postgres://ai_job_apply:local_only@127.0.0.1:55432/ai_job_apply"
pnpm --filter @ai-job-apply/trust-service test:integration
```

The integration suite applies and replays both explicit migrations, then proves owner isolation,
idempotent case opening,
different-reviewer enforcement at the SQL boundary, version conflicts, immutable audit/evidence,
private signal projection, candidate export redaction, no-public-execute function ACLs,
unauthorized and cross-owner deletion denial, transactional child-first candidate deletion, and
absence of Trust-to-Jobs database dependencies. Candidate deletion is the only context in which
the protected history may be removed.

## Not implemented or authorized

- Gateway/API routes, a source-only administrative review surface, durable decision signals, and a
  default-uncomposed Jobs consumer boundary are implemented, but no live reviewer assignment,
  verified-requester authority, approved policy provider, queue, scheduler, or deployment
  composition is wired.
- No decision automatically publishes, activates, refreshes, blocks, restores, or removes a job.
- No aggregate reputation score, automatic sanction, reward, or contributor-facing ranking exists.
- No live policy version, appeal timing, response SLA, retention period, license, takedown channel,
  requester-verification process, or reviewer organization has accountable approval.
- No real-candidate, public-contribution, provider-fixture, cloud-deployment, or store-release
  evidence is claimed. ADR-028 and the D2 release gates keep all such behavior disabled.

The eventual orchestration boundary must authenticate contributors and reviewers, authorize exact
scopes, recheck consent and independent verification, pass identifiers only, consume Trust results
idempotently, and make any Jobs lifecycle change through a separately reviewed Jobs-owned command.
