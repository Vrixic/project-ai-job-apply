# D3-067: Private preparation port into isolated Documents execution

Date: 2026-10-04
Status: Source, focused/connected and exact-source full maintained verification passed; review/release gates remain.

The backend-only branch starts from freshly fetched main `bde17d9` and locally integrates
exact open #536 head `2a69030` as an explicit dependency. No GitHub merge is performed.

## Result and acceptance path

`application-preparation-documents.ts` supplies the missing default-off
`CoverLetterPreparationPort` to the existing private Applications preparation activity:
accepted outbox/event record → owned Applications/Profile/Jobs context under candidate lease
→ Applications' original generation claim → Documents reservation and private-slot grant/claim
→ original isolated Invoke → provider-only private control → read/ground/verify/render original
result → independent final writer → Applications-owned hash-bound mandatory-review packet.

The activity still loads its record from the immutable outbox/event binding. The new port
accepts only those trusted private records, not candidate wire input. It projects eight original
identity/consent fields and never refreshes approval or expiry. Generation and recovery require
an existing running Applications claim. Context returns only current job/evidence hashes; no
candidate facts, prompt, paragraphs or credentials enter durable input/output/checkpoints.

Generation composes the existing initializer, one-dispatch service and numeric Invoke port.
Retry recovery goes directly to the independent draft recovery service: it has no slot creation,
initializer, grant issuance or Invoke capability. It may finish a positively acknowledged
original result after disclosure expires, with current evidence/candidate/final-writer checks.
Physical finalization is distinct from model dispatch; existing PDF/DOCX parsing, grounding and
immutable object/SQL protections are reused. The private activity receives no model/provider key.

Capability facades bind the supplied Documents methods and separate lease from persistence.
Owner clients must preserve their supported database codecs and use separate pools: never hold
a one-connection lease while performing a nested query through that same pool. The test uses
Profile's own client for Profile; raw Date/JSON-preserving clients for Applications/Documents/
work; Jobs' own client; and an independent candidate lease, each limited to one connection.
The existing Applications client factory supplies raw compatible SQL clients for test fixtures;
this does not grant cross-owner query authority. Production bootstrap is still required.

## Executed checks

- 18 new port unit cases and 21 existing owned-evidence cases pass (39 focused). Default-off,
  malformed identity, original claim/state, hash-only context, current evidence changes, missing
  reservation, detached original consent, expiry-safe recovery, withdrawn activation and fixed
  diagnostic refusal are covered. Routing unit cases use spies; connected cases below execute
  the actual initializer/preparation/recovery implementations.
- Seven generated-synthetic PostgreSQL cases exercise actual Profile, Jobs, Applications and
  Documents ownership, migrations/transactions, the new port, isolated handler/private control,
  original grants, production grounding/render verification and packet completion. All pools
  use one connection and the lease is independent. No provider settlement is manually seeded.
- One case registers the actual activity/new port in the installed durable SDK test runner with
  native time, verifies successful execution and a hash-bound generated field requiring review.
- Lost original Invoke ACK recovers the original result; a delayed original result finishes after
  disclosure expiry. Both make one original Invoke/model call and one final object write, preserve
  original consent, and replay the same packet without dispatch or object creation.
- Lost slot or grant ACK remains unresolved: retry creates no slots, issues no new grant, invokes
  no provider and leaves original authorization rows unchanged. SQL deletion still refuses those
  running/issued cases. Quarantine refuses context/finalization and retains the pending document;
  the incomplete ledger reports `untracked`, never a quiescence or purge certificate. Context
  refusal retains the existing fixed retryable `context_unavailable` outcome.
- Provider Invoke bytes are document/object references only; activity/durable outputs carry
  identifiers/fixed outcomes and contain no fact value or candidate owner. Public API, event,
  domain and migration shapes are unchanged. No frontend or deployed user journey is changed.

The first fixture attempt incorrectly imported an undeclared transitive PostgreSQL package,
then used Profile's transformed SQL client for Documents writes. Both were corrected with
existing supported raw client factories; no dependency or codec relaxation was introduced.
A missing `{definitions}` constructor wrapper was also corrected. The quarantine assertion was
aligned with the existing activity's context refusal contract, and direct SQL-delete assertions
remain only for positive unresolved running/issued states. No production protection is weakened.

Local environment: Windows, Node 24.12.0, pnpm 10.24.0, PostgreSQL 16.14-alpine. The owned
loopback-only tmpfs fixture `private_preparation_d3_067` used port 55438. External authentication,
S3, Lambda transport and model completion were simulated. No live provider/AWS/model calls.
The exact fixture container is removed after checks; Docker Desktop and WSL stop, retaining
shared volumes. Logs (ignored): `.tmp/d3-067-focused.log`, `.tmp/d3-067-typecheck-final.log`,
`.tmp/d3-067-integration-final.log`, `.tmp/d3-067-build.log`.

## Remaining gates

Full maintained verification passes as recorded below. This is source composition, not a native Lambda
bootstrap, published artifact, deployment, live-provider evaluation or user journey acceptance.
Native activity/durable/dispatch/recovery bootstrap/artifacts, IAM/caller/secret/object policies,
maintained scheduling, transient retention/expiry, ambiguous abandonment, original writer drain
and accountable security/privacy/deployed acceptance remain. Migration 0009/current-source
restore release from #535 still precedes updated owning functions. No phase-exit box changes;
D1/D3 remain In progress and hosted CI/CD remains deferred until production launch.

The compiled-port guard `scripts/tests/private-preparation-port-bundle.test.mjs` also passes.
It positively requires owning evidence, controlled preparation/initialization and original
draft/provider-result recovery, and rejects emitted legacy direct generation, ModelGateway,
OpenAI/background/cleanup implementations, isolated actor, provider-key resolver and maintenance
actor. Parsed barrel reexports with zero emitted bytes are not capabilities. The maintained
verifier now includes this boundary check; this is not a native activity artifact or deployment.

## Capability-facade review checkpoint

The first full verifier passes at source `3861c69`: 38 typecheck tasks, 39 test tasks and
23 builds; unchanged zero-error/15-warning/58-info lint baseline. Before review, the private
constructor composition was tightened: owning reads, candidate lease, original-work controls,
initialization and recovery now receive exact frozen method facades. Recovery's runtime
store has no reservation method, its provider objects are read-only, and initialization has
no provider-dispatch/finalization capabilities. This closes a broader-object gap despite the
earlier narrow static types. No core SQL, shared contract or grant semantics are changed.

Twenty new port cases plus 21 existing evidence cases pass (41 focused), including two tests
inspecting the actual constructor capability sets. All seven real PostgreSQL cases pass again
on the final facade source using a fresh owned tmpfs fixture. Workflow build, typecheck and
the emitted-port model-isolation guard also pass. The first full-verifier result is historical;
full verification for the final facade source remains pending. The owned fixture is removed
and Docker Desktop/WSL are stopped again.

## Private-slot purpose guard checkpoint

The initializer's frozen ledger facade now also restricts issue, claim and settlement to
`private_slots`, refusing provider-dispatch/final-document purposes before any owning ledger
call. Inputs are detached before delegation. Two additional refusal cases bring focused
verification to 43 passing tests (22 port and 21 evidence cases). Seven real PostgreSQL cases,
Workflow build/typecheck and emitted model-isolation check pass again on this final source.
Docker fixture removed; Desktop and WSL stopped. The verifier started at 56f0b29 also passed,
but source changed during execution, so it is superseded by a clean-source full rerun.
No schema, SQL authorization, frontend or deployment change.

## Final exact-source verification

Clean source `869f0fca0f943c1f7ec39d277788762b464b0feb` passes the maintained
`scripts/verify-phase0.ps1` with terminal exit 0 and its completion marker: 38 typecheck
tasks, 39 test tasks and 23 builds. Workflow units: 1,434 passed and 27 explicitly skipped,
including seven opt-in SQL cases separately executed above. Lint remains zero errors,
15 warnings and 58 informational notes. Formatting, generated contracts, dependency-security
regressions, operational/security guards, all three emitted capability checks and Compose
configuration pass. Log: `.tmp/d3-067-full-verification-869f0fc.log` (ignored).

43 focused cases, seven real PostgreSQL cases and emitted isolation/build/typecheck proof
cover the final purpose-guard source. New evidence links resolve and the prior delivery history
is retained. Documentation-only follow-ups do not change the tested source. Windows local
verification uses simulated authentication/S3/Invoke/model responses and no live AWS/provider
requests. Docker Desktop and WSL are stopped; no owned SQL fixture remains. Native runtime
bootstrap/artifacts, release/IAM/scheduling, retention/abandonment/original writer drain and
accountable/deployed acceptance remain. D1/D3 stay In progress; hosted CI/CD stays deferred
until production launch.

## Review handoff

[PR #537](https://github.com/Vrixic/project-ai-job-apply/pull/537) opens on exact #536 source dependency `2a69030`; no GitHub merge is performed.
Only delivery documentation changes after verified source `869f0fc`. Native runtime wiring
and release/accountable acceptance remain open, and the isolated path stays disabled.
Hosted checks are not monitored under the owner's production-launch deferral.
