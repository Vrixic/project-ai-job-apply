# D1 Job Reporting, Moderation, and Source-Control Policy Review Brief

- Packet status: Prepared for accountable review
- Decision status: Every D1P row is `Not started`; every authorization flag is `false`
- Prepared: 2026-08-16
- Engineering input baseline: `3576a2a9dd21f8ae44c5e46db07a4b72178c9747`
- Accountable roles: Product owner; security/privacy reviewer; legal/privacy counsel;
  operations/trust owner; source engineering; platform/security engineering;
  architecture/platform engineering; named individuals unassigned
- Disposition record: [D1 policy disposition worksheet](d1-reporting-moderation-policy-review-disposition.md)

This brief asks accountable reviewers to define the narrow policy and privileged audience needed to
finish D1-007. It records engineering facts and questions only. It does not choose an administrator
identity provider or audience, grant a scope, approve a threshold, authorize suppression or source
resume, approve retention, activate a route, or change delivery status.

## Decision rows and stop boundary

| ID | Accountable decision | Required roles | State | Authorization in force |
|---|---|---|---|---|
| D1P-01 | Administrative audience, identities, scopes, ownership predicates, and privileged-access controls | Product owner; security/privacy reviewer | Not started | `false` |
| D1P-02 | Candidate/admin separation and the minimum moderation data view | Product owner; security/privacy reviewer; operations/trust owner | Not started | `false` |
| D1P-03 | Report aggregation, case-opening, review, and job-suppression thresholds | Product owner; operations/trust owner; security/privacy reviewer | Not started | `false` |
| D1P-04 | Source-pause escalation and source-resume authority for an exact source/adapter/configuration | Product owner; source engineering; operations/trust owner; legal/privacy counsel where source authority is implicated | Not started | `false` |
| D1P-05 | Alert thresholds, recipients, acknowledgement, escalation, and privacy-safe evidence | Operations/trust owner; platform/security engineering | Not started | `false` |
| D1P-06 | Report, moderation, source-control, and privileged-audit retention, deletion, export, and access | Product owner; legal/privacy counsel; security/privacy reviewer | Not started | `false` |
| D1P-07 | Employer/provider correction, takedown, review, and appeal operation | Product owner; legal/privacy counsel; operations/trust owner | Not started | `false` |
| D1P-08 | D1 provider-catalog boundary versus D2 public-UGC moderation | Product owner; architecture/platform engineering; legal/privacy counsel | Not started | `false` |

While any applicable row remains open:

- no administrator/support audience, privileged API, admin UI, administrative scope, or operator
  role may be released;
- candidate reports remain evidence only and cannot automatically open or resolve a case, suppress,
  expire, block, merge, or otherwise change a job, or pause or resume a source;
- no source-resume operation exists or is authorized;
- no report-count, reason, alert, or moderation event can stand in for a source-specific approval;
- no real reports or provider data may be processed under this packet; and
- the existing synthetic/default-off gates and the separate LR-D1 source and real-candidate gates
  remain unchanged.

## Current implemented source facts

### Candidate report boundary

The candidate route is `POST /v1/jobs/{jobId}/reports`. It requires the existing candidate
`jobs:write` permission and resolves the managed OIDC principal to one internal owner UUID before
calling Jobs. The command contains one lowercase UUIDv7 job identifier, one bounded idempotency key,
and exactly one of six reason codes: `job_closed`, `job_not_found`, `job_inaccurate`,
`suspected_scam`, `duplicate_listing`, or `other_catalog_issue`.

The contract accepts no free text, source URL, provider identity, candidate profile value, or
moderation outcome. Jobs retains report identity, reporter UUID, requested and canonical job IDs,
reason, idempotency/request hashes, and creation time. It accepts at most one retained report per
owner/canonical-job pair and has a source-enforced ceiling of 1,000 retained reports per owner.
Candidate responses are `no-store` and do not expose catalog lifecycle or another owner.

### Moderation and source-control boundary

Jobs owns an internal persistence port, not an authenticated administrative API. A moderation case
targets either one job UUID or the exact tuple `(sourceId, adapterVersion,
adapterConfigSha256)`. The implemented opening reasons are `candidate_reports`,
`catalog_integrity`, and `source_integrity`. The implemented terminal resolutions are `no_action`,
`block_job`, and `pause_source`, with fixed resolution reasons.

A job block is an explicit transactional decision that changes that canonical job to `blocked` and
appends lifecycle and moderation audit. A source pause is an immutable, exact-target decision. The
durable ingestion runtime checks it before schedule/resume, attempt execution, polling, and each
subsequent catalog write; one already-issued idempotent write may finish before the next check.
Terminal reconciliation continues while paused.

The source exposes aggregate reason counts for one canonical job without reporter identities. It
does not implement automatic aggregation-to-action, a source resume, case reopening, takedown,
appeal, individual-report admin reads, admin identity, admin scopes, notification, or policy alert.

### Ownership and implementation state

| Boundary | Current owner | Current state |
|---|---|---|
| Candidate report contract, principal resolution, and transport enforcement | Gateway/Profile composition into Jobs | Implemented and locally verified source; no D1-007 deployment or real-report acceptance claimed |
| Report ledger, canonical target resolution, moderation cases, job block, exact source pause, and moderation events | Jobs | Implemented source; migration is not applied for D1-007 |
| Exact pause enforcement during source-neutral durable ingestion | Ingestion worker consuming the Jobs-owned decision | Implemented source, default off, synthetic-only |
| Moderation policy, source reputation, abuse, takedowns, and appeals | Trust | Planned README boundary; no implementation |
| Privileged moderation/support user experience | Admin console | Planned README boundary; no implementation |
| Privileged route authentication/authorization | Gateway/admin BFF | No audience, route, or scope implemented |
| Operational alert delivery foundation | Platform/observability | Generic infrastructure exists; no approved D1 report/moderation policy metric or threshold |

These facts are documented in the [Jobs boundary](../../../backend/services/jobs/README.md),
[reporting domain](../../../backend/services/jobs/src/reporting.ts),
[reporting persistence](../../../backend/services/jobs/src/persistence/reporting.ts),
[reporting migration](../../../backend/services/jobs/migrations/0008_job_reporting_and_moderation.sql),
[ingestion boundary](../../../backend/workers/ingestion/README.md),
[Trust boundary](../../../backend/services/trust/README.md), and
[Admin boundary](../../../frontend/admin/README.md).

## Non-negotiable architecture and safety constraints

Reviewers may narrow behavior but may not silently override these accepted boundaries:

- candidate and administrative interfaces have different exposure classes; an administrative
  token is not a candidate token with more scopes;
- privileged access is least-privilege, reason-bound, time-bounded where applicable, step-up
  authenticated, immutable-audited, alerted, and tested for cross-role denial;
- reporter identity is candidate data inside Jobs and is not exposed in ordinary moderation views;
- reports and alerts are evidence, never an automatic job/source lifecycle command;
- source control is exact to source, adapter version, and configuration digest; a broader wildcard
  control or implicit inheritance to a changed adapter/configuration is prohibited;
- source approval, activation, pause, and resume are distinct accountable acts; public-read
  mechanics do not establish aggregation or reactivation authority;
- moderation must not become hidden candidate screening or use protected traits or reporter
  identity; any future source-trust matching feature remains a separately reviewed Matching concern;
- only minimum data may enter logs, metrics, events, tickets, or alert payloads; and
- D1 stops at provider-fed catalog reporting/control. D2 separately owns public contribution,
  contributor reputation, UGC license, contribution moderation, and UGC removal/appeal.

See the [architecture service ownership](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md#7-service-responsibilities),
[API exposure classes](../../security/api-security-and-final-review.md#exposure-classes),
[D1 report data flow](../../security/data-flow-and-classification.md#d1-candidate-job-report-and-moderation-source-boundary),
and [D1-007 threat delta](../../security/threat-model.md#d1-007-reportingmoderation-source-delta).

## D1P-01 — Administrative audience, identity, and authorization

The reviewers must record:

1. the exact administrative issuer and audience, environment isolation, client/application type,
   token lifetime, session controls, MFA/step-up rule, and whether any shared-development identity
   exception is prohibited for privileged use;
2. the exact named human or workload identity classes allowed to call each operation and the
   system that assigns, reviews, expires, and revokes them;
3. a distinct least-privilege scope for each capability: aggregate report read, case read/open,
   job-block decision, source-pause decision, any future resume request/approval, reporter-link
   access, rights/export/deletion operation, and audit read;
4. the object/function/property predicates for job ID, source tuple, environment, organization or
   queue assignment, case state/version, and action type;
5. whether the opener may resolve the same case, whether source control requires two different
   people, and what separation applies to urgent safety action;
6. the reason, ticket/reference, time limit, reauthentication, and alert required for ordinary and
   break-glass actions; and
7. negative tests for candidate token, wrong audience/environment, insufficient scope, expired or
   revoked grant, cross-role, object mismatch, parameter overposting, and direct service access.

No exact audience, scope string, role, grant source, owner predicate, or break-glass policy is
selected by this brief.

## D1P-02 — Candidate/admin separation and minimum view

Decide the exact response allowlist for each administrative capability. Ordinary moderation should
start from canonical job/source identity, fixed reason aggregates, case state/version, fixed reason
codes, and timestamps—not candidate identity or profile data.

Reviewers must answer:

- Can any non-privacy operator access an individual report? If yes, identify the necessity,
  allowlisted fields, scope, reason, time limit, audit, and alert.
- Can an operator link reports from the same candidate across jobs? The default authorization is
  `false` until explicitly approved.
- Is the candidate entitled to view only their submission receipt, a later status, or neither?
  A moderation outcome must not disclose another reporter, internal fraud signal, or source secret.
- Which fields must be redacted from admin lists, exports, screenshots, tickets, and alert payloads?
- Which service owns each read model so the Admin client never queries Jobs tables directly?

## D1P-03 — Moderation thresholds and suppression

Define separate thresholds for queueing a human review, escalating urgency, and making a manual
decision. For every rule, record the eligible reason codes, time window, total reports, minimum
distinct reporters, source/job grouping, deduplication, reporter-abuse controls, stale-evidence
expiry, and required corroborating catalog/source signals.

The disposition must state whether the threshold produces only an alert, only a review queue item,
or both. Every automatic lifecycle action remains `false`: no threshold may block, expire, withdraw,
merge, deindex, pause, or resume anything. An accountable operator must inspect evidence and issue
the explicit versioned action through the approved privileged boundary.

Also define:

- handling of a single `suspected_scam` report versus repeated lower-severity reports;
- protection against brigading, compromised accounts, repeated aliases, and correlated reports;
- maximum queue age, review priority, evidence sufficiency, and `no_action` rationale;
- false-positive sampling, reversal/correction measurement, and policy revalidation; and
- whether a blocked job can be restored, through what new case/action, and by whom. No restore
  operation currently exists.

## D1P-04 — Source pause and any future resume

Separate emergency pause from reactivation. Reviewers must define signals and authority for an
explicit exact-source pause, including provider complaint, permission loss, security event,
integrity failure, excessive errors, or takedown failure. A report count alone cannot pause a
source automatically.

No resume exists today. Before one can be designed, the disposition must answer:

1. Is resume permitted at all, or must reactivation always create a new activation record?
2. Which requester and independent approver roles are required?
3. Must the exact `sourceId`, `adapterVersion`, `adapterConfigSha256`, provider/tenant, environment,
   reviewed contract/terms version, approval-record ID, deployment artifact, and allowlisted egress
   configuration match the requested activation?
4. Which changed value forces a new source-specific legal/security/engineering review rather than
   a resume?
5. What evidence proves the pause cause is remediated, queues/checkpoints are reconciled, no stale
   scheduled work can run, the current adapter tests pass, and downstream catalog state is safe?
6. What two-person control, delay, expiry, rollback, notification, and append-only event are needed?
7. How is a resumed exact configuration prevented from authorizing another provider, tenant,
   adapter version, configuration digest, environment, or source?

The separate [D1 source/onboarding review packet](d1-source-and-onboarding-review-brief.md) and its
LR-D1 rows still govern real-source authority. This policy packet cannot approve or activate them.

## D1P-05 — Alerts and escalation

Distinguish policy signals from technical-health signals. Define each metric, evaluation window,
threshold, missing-data behavior, severity, destination, accountable recipient, acknowledgement
deadline, secondary escalation, runbook, and resolution evidence. Candidate values, report bodies,
reporter identifiers, URLs, and provider payloads must not be alert dimensions or messages.

At minimum, reviewers should disposition:

- unusual report rate by fixed reason and canonical/source aggregate;
- oldest unreviewed case and review-queue depth;
- job blocks and source pauses as privileged-action notifications;
- denied, failed, expired, and break-glass administrator actions;
- pause-gate read failures and attempted execution while paused;
- any approved resume request, approval, execution, failure, or mismatch; and
- retention/deletion/export reconciliation failure for D1 records.

No threshold, recipient, service level, or paging policy is selected here. An alert never mutates
job or source state.

## D1P-06 — Retention, deletion, export, and audit

The current report ledger is immutable and retains a reporter UUID; moderation cases/events retain
operator IDs and exact target/action/reason/times. No D1-specific deletion, pseudonymization,
export, or approved retention schedule exists. The provisional general schedule is not approval.

For each of the following, set a duration or event-based rule, lawful hold/exception, access class,
deletion or pseudonymization action, export treatment, backup aging, restore reconciliation, and
verification evidence:

- candidate report row and owner link;
- idempotency and request hashes;
- aggregate report counts/read models;
- moderation case and append-only events;
- job/source lifecycle and minimal tombstone evidence;
- privileged access/action audit;
- alert, ticket, and incident metadata; and
- short-lived export artifacts and deletion ledgers.

Resolve the conflict between immutable report/audit guards and candidate deletion. State whether
the owner link is deleted, irreversibly pseudonymized, retained under a specific approved basis, or
handled through another reviewed design. Define what appears in a candidate export and what
internal security, another candidate's data, or operator data is excluded. Any implementation must
remain consistent with the [retention specification](../../security/retention-and-deletion.md) and
must be tested through backup restore before real-candidate use.

## D1P-07 — Correction, takedown, and appeal

Define an authenticated and abuse-resistant channel for an employer, provider, affected person, or
candidate to request correction or removal of a provider-fed catalog job. Record required evidence,
identity verification, urgent-safety path, acknowledgement and decision times, temporary display
treatment, reviewer independence, reasons communicated, appeal window, second review, audit,
cache/search reconciliation, and minimal retained tombstone.

Also decide whether a candidate may correct or withdraw their own report and how that interacts
with immutable evidence and aggregates. No withdrawal, takedown, reversal, or appeal operation is
implemented, and this brief authorizes none.

## D1P-08 — D1/D2 separation

D1 policy covers candidate reports about provider-fed/canonical jobs and explicit internal control
of those jobs and exact configured sources. It does not approve or implement:

- extension/public contribution intake or contributor consent;
- contributor reputation, rewards, sanctions, or identity-link review;
- UGC publication, contributor license/representations, repeat-abuse policy, or UGC provenance;
- contribution-specific moderation, withdrawal, takedown, appeal, or tombstone rules; or
- D2 extension permissions, browsing-data handling, store review, or representative UGC fixtures.

If one admin console later hosts both capabilities, it must preserve separate contracts, scopes,
queues, reason taxonomies, ownership, data views, policy versions, legal gates, and audit actions.
No D1 report threshold or source action may be reused as a D2 UGC decision without a D2 review.

## Evidence required before implementation or activation

- [ ] Every D1P row has an attributable disposition and all blocking findings are closed.
- [ ] Exact administrative issuer/audience/scopes/role source, expiration, step-up, and owner
      predicates are frozen.
- [ ] Candidate/admin/service exposure inventory and complete negative authorization tests pass.
- [ ] Exact policy version, thresholds, queue behavior, redaction, and manual decision controls pass
      deterministic and abuse tests without automatic lifecycle/source changes.
- [ ] Any resume design is exact-target, append-only, two-person where approved, linked to current
      source authority, and independently tested; otherwise resume remains absent.
- [ ] Privacy-safe metrics, alert delivery, acknowledgement, escalation, and runbooks are exercised.
- [ ] Approved retention/deletion/export/audit behavior is implemented across primary storage,
      caches, alerts/tickets, backups, restores, and deletion-ledger reconciliation.
- [ ] Correction/takedown/appeal channels and downstream search/cache reconciliation are tested.
- [ ] D1 and D2 contracts, scopes, data, queues, policy, and approval records remain separate.
- [ ] Immutable artifacts, migration, deployment, managed-identity browser/API acceptance, current
      restore evidence, and accountable security/privacy review pass.

## Revalidation and fail-closed stop conditions

The approved policy must name its owner and revalidation date. Suspend the privileged interface and
deny new execution under the separately governed activation/authorization gates when
identity/audience/scope configuration drifts, an authorization or privacy test fails,
reporter/operator data leaks, an automatic lifecycle mutation occurs, alert delivery fails beyond
the approved window, retention enforcement drifts, an appeal/takedown SLA is missed, provider
authority changes, the exact adapter/configuration changes, or the D1/D2 boundary is crossed. These
conditions do not themselves write job or source lifecycle; any persisted block or pause still
requires the explicit versioned operator action. Stopping behavior does not authorize later resume.
