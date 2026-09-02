# Trust Service

Owns private UGC moderation decisions, contributor/source reputation evidence, contribution
withdrawal, takedown, and one bounded appeal. It must not rank candidates or directly mutate Jobs
catalog truth.

## Implemented synthetic/default-dark foundation

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

## Package commands

```powershell
pnpm --filter @ai-job-apply/trust-service typecheck
pnpm --filter @ai-job-apply/trust-service test
pnpm --filter @ai-job-apply/trust-service build
$env:DATABASE_URL = "postgres://ai_job_apply:local_only@127.0.0.1:55432/ai_job_apply"
pnpm --filter @ai-job-apply/trust-service test:integration
```

The integration suite applies and replays the explicit migration, then proves owner isolation,
different-reviewer enforcement at the SQL boundary, version conflicts, immutable audit/evidence,
private signal projection, and absence of Trust-to-Jobs database dependencies. It intentionally
retains only generated synthetic evidence because the production design forbids deleting or
rewriting audit history in place.

## Not implemented or authorized

- No gateway/API routes, OIDC audience/scopes, administrative UI, live reviewer/account/requester
  authority adapters, approved policy provider, durable workflow, notification, or Jobs
  reconciliation consumer is wired.
- No decision automatically publishes, activates, refreshes, blocks, restores, or removes a job.
- No aggregate reputation score, automatic sanction, reward, or contributor-facing ranking exists.
- No live policy version, appeal timing, response SLA, retention period, license, takedown channel,
  requester-verification process, or reviewer organization has accountable approval.
- No real-candidate, public-contribution, provider-fixture, cloud-deployment, or store-release
  evidence is claimed. ADR-028 and the D2 release gates keep all such behavior disabled.

The eventual orchestration boundary must authenticate contributors and reviewers, authorize exact
scopes, recheck consent and independent verification, pass identifiers only, consume Trust results
idempotently, and make any Jobs lifecycle change through a separately reviewed Jobs-owned command.
