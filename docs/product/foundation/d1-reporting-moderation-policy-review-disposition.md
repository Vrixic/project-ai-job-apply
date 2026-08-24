# D1 Job Reporting, Moderation, and Source-Control Policy Disposition Worksheet

- Worksheet status: Ready for accountable input; review has not started
- Decision state: Every D1P row is `Not started`
- Authorization state: Every privileged/automatic/activation flag is `false`
- Prepared: 2026-08-16
- Scope: D1P-01 through D1P-08
- Accountable roles: Product owner; security/privacy reviewer; legal/privacy counsel;
  operations/trust owner; source engineering; platform/security engineering;
  architecture/platform engineering; named individuals unassigned
- Review brief: [D1 policy review brief](d1-reporting-moderation-policy-review-brief.md)

This worksheet is an empty attributable decision record, not a policy, approval, implementation
specification, administrative grant, or source activation. Preserve `Not started` and `false` until
the named accountable people actually review the frozen package and complete the relevant cells.

## Allowed decision state and closure rule

Use exactly one state for each D1P row:

| State | Meaning | Gate effect |
|---|---|---|
| `Not started` | No accountable review has begun or no attributable conclusion exists. | All related authorizations remain `false`; strict source-only/default-off behavior continues. |
| `In review` | Named reviewers are evaluating one frozen candidate. | No authorization changes. |
| `Changes required` | Reviewers require implementation, evidence, or a narrower proposal. | Row remains open; all related authorizations remain `false`. |
| `Approved` | Every required role approved the exact recorded decision and all release-blocking conditions are closed. | Governance may separately authorize implementation/release; approval does not deploy or activate anything. |
| `Rejected` | Reviewers declined the requested behavior. | The behavior remains absent/disabled until a new version is reviewed. |

An approval is invalid without exact scope, reviewer names/roles, date, immutable package identity,
conditions, evidence, and revalidation. Product-owner acceptance cannot override legal prohibition
or independent security/privacy conditions.

## Immutable review candidate

| Field | Value |
|---|---|
| Repository commit reviewed | Pending |
| Commit parent/tree | Pending |
| Policy version | Pending |
| Administrative identity configuration revision | Pending; none implemented |
| API/OpenAPI and generated-contract revision | Pending; no admin route exists |
| Database/migration revision | Pending |
| Ingestion runtime and exact source-control revision | Pending |
| Deployed environment/artifact identity | Pending; D1-007 not deployed |
| Review start/completion | Not started |

### Required packet artifacts

Mark each `Reviewed`, `Reviewed with finding`, or `Not reviewed`.

| Artifact | Reviewer state/finding IDs |
|---|---|
| [Policy review brief](d1-reporting-moderation-policy-review-brief.md) | Not reviewed |
| [Product and system architecture](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md) | Not reviewed |
| [Phase 1 delivery record](../delivery/phase-1-web-and-job-catalog.md) | Not reviewed |
| [Jobs boundary](../../../backend/services/jobs/README.md) | Not reviewed |
| [Reporting domain](../../../backend/services/jobs/src/reporting.ts) | Not reviewed |
| [Reporting persistence](../../../backend/services/jobs/src/persistence/reporting.ts) | Not reviewed |
| [Reporting migration](../../../backend/services/jobs/migrations/0008_job_reporting_and_moderation.sql) | Not reviewed |
| [Ingestion worker boundary](../../../backend/workers/ingestion/README.md) | Not reviewed |
| [Trust boundary](../../../backend/services/trust/README.md) | Not reviewed |
| [Admin boundary](../../../frontend/admin/README.md) | Not reviewed |
| [Conservative technical baseline](d1-moderation-implementation-baseline.md) | Not reviewed |
| [API security/exposure baseline](../../security/api-security-and-final-review.md) | Not reviewed |
| [D1 report data flow](../../security/data-flow-and-classification.md#d1-candidate-job-report-and-moderation-source-boundary) | Not reviewed |
| [D1-007 threat delta](../../security/threat-model.md#d1-007-reportingmoderation-source-delta) | Not reviewed |
| [Retention and deletion specification](../../security/retention-and-deletion.md) | Not reviewed |
| [Separate source/onboarding packet](d1-source-and-onboarding-review-brief.md) | Not reviewed |
| [UGC lifecycle ADR](../../adr/005-ugc-lifecycle.md) | Not reviewed |

## Reviewer identity and accountability

| Role | Named reviewer/organization | Authority and scope | Date | Attributable record |
|---|---|---|---|---|
| Product owner | Unassigned | Pending | Not started | Pending |
| Security/privacy reviewer | Unassigned | Pending | Not started | Pending |
| Legal/privacy counsel | Unassigned | Pending | Not started | Pending |
| Operations/trust owner | Unassigned | Pending | Not started | Pending |
| Source engineering owner | Unassigned | Technical evidence only; cannot grant provider/legal authority | Not started | Pending |
| Platform/security engineering owner | Unassigned | Alert, authorization, and implementation evidence; cannot grant product/legal authority | Not started | Pending |
| Architecture/platform engineering owner | Unassigned | D1/D2 boundary and implementation evidence; cannot grant product/legal authority | Not started | Pending |

## Global authorization flags

These flags are authoritative defaults for this worksheet. Set a value to `true` only after the
linked approved row and separately governed implementation/release evidence exist.

| Authorization | Current value | Required row/evidence before change |
|---|---:|---|
| Administrative audience/client may be created or configured | `false` | D1P-01 plus reviewed identity plan |
| Administrative route/API/UI may be implemented | `false` | D1P-01 and D1P-02 |
| Administrative route/API/UI may be deployed | `false` | D1P-01/D1P-02 approval plus security/deployment evidence |
| Candidate report threshold may automatically create a review queue item or case | `false` | D1P-03 exact rule plus implemented/tested evidence; it may not change lifecycle |
| Candidate report or threshold may automatically change job lifecycle | `false` | Prohibited by current packet boundary |
| Candidate report or threshold may automatically pause a source | `false` | Prohibited by current packet boundary |
| Alert may automatically change job or source state | `false` | Prohibited by current packet boundary |
| Human operator may block a job through a privileged interface | `false` | D1P-01/D1P-03 plus implemented/tested manual boundary |
| Human operator may pause one exact source/adapter/configuration | `false` | D1P-01/D1P-04 plus current source authority and tested manual boundary |
| Any source-resume/reactivation operation may be designed | `false` | Explicit D1P-04 conclusion |
| Any source-resume/reactivation operation may execute | `false` | D1P-04, exact ADR-025 activation record, implementation, deployment, and two-person evidence if required |
| Individual reporter identity may be viewed by ordinary moderation | `false` | Explicit D1P-02 and D1P-06 necessity/authorization |
| Real candidate reports may be processed | `false` | LR-D1-04 plus D1P-01 through D1P-07 and deployed acceptance |
| Real provider source may be activated | `false` | Exact ADR-025 company activation record plus source-specific implementation/release evidence |
| D1 policy may govern D2 public UGC or contributor reputation | `false` | Prohibited; D2-specific review required |

## D1P-01 — Administrative audience, identity, scopes, and predicates

- State: `Not started`
- Approval flag: `false`

| Decision field | Accountable value |
|---|---|
| Administrative issuer | Pending |
| Exact audience | Pending |
| Environment/account/tenant isolation | Pending |
| Client/application type and secret boundary | Pending |
| Token/session lifetime, MFA, step-up, reauthentication | Pending |
| Human identity source and employment/offboarding lifecycle | Pending |
| Workload identities, if any | Pending |
| Role assignment, periodic access review, expiry, revocation | Pending |
| Aggregate report-read scope | Pending |
| Case read/open scopes | Pending |
| Job-block decision scope | Pending |
| Exact source-pause decision scope | Pending |
| Resume request/approval scopes, if resume is permitted | Pending |
| Reporter-link access scope | Pending |
| Rights/export/deletion scopes | Pending |
| Audit-read scope | Pending |
| Job/source/environment/queue/case owner predicates | Pending |
| Same-person open/resolve rule | Pending |
| Two-person/source-control rule | Pending |
| Ordinary privileged-action reason/expiry/audit/alert | Pending |
| Break-glass reason, duration, approver, alert, and review | Pending |
| Required denial and abuse tests | Pending |
| Named decision makers/date/reference | Pending |

## D1P-02 — Candidate/admin separation and minimum view

- State: `Not started`
- Approval flag: `false`

| Decision field | Accountable value |
|---|---|
| Separate admin route family and exposure inventory | Pending |
| Candidate-token denial and admin-token candidate-route behavior | Pending |
| Default moderation list/detail allowlist | Pending |
| Reporter identity visible to ordinary moderator | `false` |
| Individual report access exception | None authorized |
| Same-candidate cross-job linking | `false` |
| Candidate-visible receipt/status/outcome | Pending |
| Admin redaction for UI, export, screenshot, ticket, and alert | Pending |
| Service-owned read models and direct-table denial | Pending |
| Cross-role/object/property/overposting test matrix | Pending |
| Named decision makers/date/reference | Pending |

## D1P-03 — Report thresholds, review, and suppression

- State: `Not started`
- Approval flag: `false`
- Automatic job/source lifecycle action: `false`

Copy one row per proposed rule. Do not use `Approved` until all cells are exact.

| Rule ID | Eligible reasons | Window | Total reports | Minimum distinct reporters | Job/source grouping | Corroborating signals | Output (`alert`, `queue`, or both) | Review priority/SLA | State |
|---|---|---|---:|---:|---|---|---|---|---|
| None | Pending | Pending | 0 | 0 | Pending | Pending | None | Pending | Not started |

| Policy field | Accountable value |
|---|---|
| Single suspected-scam report treatment | Pending; no automatic action |
| Deduplication and correlated/brigading controls | Pending |
| Reporter-abuse review and false-positive sampling | Pending |
| Evidence expiry/staleness | Pending |
| Maximum queue age and escalation | Pending |
| Manual evidence sufficiency for `no_action` | Pending |
| Manual evidence sufficiency for `block_job` | Pending |
| Job unblock/restore operation and authority | Not authorized; no operation exists |
| Policy quality metrics and revalidation | Pending |
| Named decision makers/date/reference | Pending |

## D1P-04 — Source pause and any future resume

- State: `Not started`
- Pause approval flag: `false`
- Resume design flag: `false`
- Resume execution flag: `false`

| Decision field | Accountable value |
|---|---|
| Approved pause signals and evidence | Pending |
| Emergency pause requester/approver | Pending |
| Pause exact target tuple | Pending; implementation currently uses `sourceId + adapterVersion + adapterConfigSha256` |
| Pause acknowledgement/escalation | Pending |
| Resume permitted at all | `false` until explicitly decided |
| Resume model: reverse, superseding activation, or new activation only | Pending |
| Resume requester and independent approver | Pending |
| Exact source/provider/tenant/environment | Pending |
| Exact adapter version and configuration SHA-256 | Pending |
| Exact source/legal approval record and reviewed terms version | Pending |
| Exact deployment artifact and egress configuration | Pending |
| Changes that require new review instead of resume | Pending |
| Cause-remediation and current-test evidence | Pending |
| Queue/checkpoint/catalog reconciliation evidence | Pending |
| Stale scheduled-work denial evidence | Pending |
| Two-person control, delay, expiry, rollback, notification | Pending |
| Append-only resume/activation audit event | Pending |
| Cross-source/version/config/environment denial tests | Pending |
| Named decision makers/date/reference | Pending |

### Exact source authority dependency

| Source | LR-D1 row | Current disposition | Resume/activation authorized |
|---|---|---|---:|
| Greenhouse | ADR-025 / former LR-D1-01 | Counsel gate removed; exact company record pending | `false` |
| Lever | ADR-025 / former LR-D1-02 | Counsel gate removed; exact company record pending | `false` |
| Ashby | ADR-025 / former LR-D1-03 | Counsel gate removed; exact company record pending | `false` |
| Synthetic foundation | Not a production approval | Generated-synthetic/default-off only | `false` for production |

## D1P-05 — Alerts and escalation

- State: `Not started`
- Approval flag: `false`
- Automatic lifecycle action: `false`

Copy one row per approved alert.

| Alert ID | Privacy-safe metric | Window/threshold/missing-data rule | Severity | Primary recipient | Acknowledge/escalate | Runbook | Resolution evidence | State |
|---|---|---|---|---|---|---|---|---|
| None | Pending | Pending | Pending | Unassigned | Pending | Pending | Pending | Not started |

Required categories to disposition:

| Category | Threshold/owner/status |
|---|---|
| Unusual fixed-reason report rate | Pending; Not started |
| Oldest unreviewed case and queue depth | Pending; Not started |
| Job block and exact source pause notification | Pending; Not started |
| Denied/failed/expired/break-glass admin action | Pending; Not started |
| Pause-gate read failure or attempted paused execution | Pending; Not started |
| Resume request/approval/execution/mismatch, if ever permitted | Pending; Not started |
| D1 retention/deletion/export reconciliation failure | Pending; Not started |

Alert payloads containing candidate values, reporter identifiers, URLs, descriptions, or provider
payloads are authorized: `false`.

| Decision record | Accountable value |
|---|---|
| Named decision makers/date/reference | Pending |

## D1P-06 — Retention, deletion, export, and audit

- State: `Not started`
- Approval flag: `false`

| Record/data | Classification/access | Retention trigger/duration | Deletion or irreversible pseudonymization | Candidate export treatment | Backup/restore reconciliation | Approval state |
|---|---|---|---|---|---|---|
| Candidate report and reporter link | Pending | Pending | Pending | Pending | Pending | Not started |
| Idempotency/request hashes | Pending | Pending | Pending | Pending | Pending | Not started |
| Aggregate report view | Pending | Pending | Pending | Pending | Pending | Not started |
| Moderation case | Pending | Pending | Pending | Pending | Pending | Not started |
| Append-only moderation event | Pending | Pending | Pending | Pending | Pending | Not started |
| Job/source tombstone/control evidence | Pending | Pending | Pending | Pending | Pending | Not started |
| Privileged access/action audit | Pending | Pending | Pending | Pending | Pending | Not started |
| Alert/ticket/incident metadata | Pending | Pending | Pending | Pending | Pending | Not started |
| Export artifact | Pending | Pending | Pending | Pending | Pending | Not started |
| Deletion ledger/completion proof | Pending | Pending | Pending | Pending | Pending | Not started |

| Required conclusion | Accountable value |
|---|---|
| Immutable-ledger versus candidate-deletion resolution | Pending; current source has no deletion path |
| Lawful holds/exceptions and who may invoke them | Pending |
| Reporter/operator access review | Pending |
| Export format, fields, download window, authentication, audit | Pending |
| Deleted-account active denial and backup aging | Pending |
| Restore-time deletion-ledger replay | Pending |
| Configuration drift detection and stop rule | Pending |
| Named legal/product/security decision makers/date/reference | Pending |

## D1P-07 — Correction, takedown, and appeal

- State: `Not started`
- Approval flag: `false`

| Decision field | Accountable value |
|---|---|
| Eligible requester classes | Pending |
| Intake channel and identity/evidence verification | Pending |
| Urgent safety/scam handling | Pending; no automatic lifecycle action |
| Acknowledgement and decision time | Pending |
| Temporary display treatment while pending | Pending; no automatic suppression authorized |
| First reviewer role and independence | Pending |
| Decision reasons disclosed to requester/candidate | Pending |
| Appeal eligibility, window, evidence, second reviewer | Pending |
| Candidate report correction/withdrawal | Not authorized; no operation exists |
| Job/source correction/reversal operation | Not authorized; no operation exists |
| Search, cache, public-page, and downstream reconciliation | Pending |
| Tombstone fields and retention | Pending |
| Abuse/repeat-request controls | Pending |
| Audit/access/alert requirements | Pending |
| Named decision makers/date/reference | Pending |

## D1P-08 — D1 provider catalog versus D2 public UGC

- State: `Not started`
- Approval flag: `false`

| Boundary | D1 accountable disposition |
|---|---|
| Candidate report on a provider-fed/canonical job | Pending within D1P-01 through D1P-07 |
| Provider-fed job/source moderation and exact pause | Pending within D1P-01 through D1P-07 |
| Public contribution intake/consent | Excluded; D2 only |
| Contributor identity/reputation/reward/sanction | Excluded; D2 only |
| UGC license/representations/publication | Excluded; D2 only |
| UGC takedown/appeal/repeat abuse | Excluded; D2 only |
| Extension permission/browsing/store behavior | Excluded; D2 only |
| Shared admin shell | Not authorized; if proposed, separate contracts/scopes/queues/views/policies/audit are required |
| D1 rule reuse for D2 decisions | `false` |
| Named decision makers/date/reference | Pending |

## Findings and conditions

Assign stable IDs such as `D1P-C01`. Do not mark a finding closed until its accountable reviewer
inspects the linked evidence.

| ID | D1P row | Effect | Required change/restriction | Owner | Closure evidence | State | Revalidation |
|---|---|---|---|---|---|---|---|

## Cross-review handoffs

| Handoff | Destination | Owner | State |
|---|---|---|---|
| Source authority/terms/field/cadence change | Applicable LR-D1-01 through LR-D1-03 row | Legal/privacy counsel; source engineering | Not started |
| Real candidate reports/identity/rights | LR-D1-04 | Legal/privacy counsel; security/privacy reviewer | Not started |
| Public contribution or contributor behavior | D2 UGC/legal/privacy/security gate | Product owner; legal/privacy counsel | Not started |
| New privileged exposure or trust-boundary change | Capability security review and final D6 exact-candidate assessment | Security/privacy owner | Not started |
| New retention/deletion/export promise | Privacy assessment, retention spec, rights implementation | Product owner; legal/privacy counsel; security/privacy reviewer | Not started |

## Final disposition summary

| Field | Value |
|---|---|
| Overall result | Not started |
| Approved D1P rows | None |
| Open rows | D1P-01 through D1P-08 |
| Open release-blocking findings | None recorded; review not started |
| Administrative audience/scopes authorized | `false` |
| Automatic lifecycle/source changes authorized | `false` |
| Manual job block/source pause release authorized | `false` |
| Source resume/reactivation authorized | `false` |
| Real candidate reports authorized | `false` |
| Real provider activation authorized | `false` |
| D2 UGC behavior authorized by this packet | `false` |
| Revalidation owner/date | Pending |

## Sign-off

| Role | Disposition/acknowledgement | Name/date/reference |
|---|---|---|
| Product owner | Not started | Pending |
| Security/privacy reviewer | Not started | Pending |
| Legal/privacy counsel | Not started | Pending |
| Operations/trust owner | Not started | Pending |

## Closure checklist

- [ ] One exact repository/deployment candidate and complete artifact manifest were reviewed.
- [ ] Every required accountable reviewer is named with scope and attributable record.
- [ ] D1P-01 through D1P-08 each have an allowed state, exact decision, and rationale.
- [ ] Every approved scope, threshold, predicate, duration, SLA, recipient, and revalidation rule is
      explicit rather than inferred from current source.
- [ ] Every finding has an owner, release effect, closure evidence, and revalidation rule.
- [ ] Candidate/admin/service separation and complete negative authorization tests pass.
- [ ] Reports, alerts, and thresholds cannot automatically change job/source lifecycle.
- [ ] Any source control is exact to the approved source/adapter/configuration/environment and any
      resume is separately authorized, implemented, audited, and independently tested.
- [ ] Retention/deletion/export/audit and takedown/appeal behavior is implemented and verified
      across primary, downstream, backup, restore, and support systems.
- [ ] D1 and D2 policy, data, scopes, queues, and approval records remain separate.
- [ ] Applicable LR-D1 source/real-candidate rows are independently approved.
- [ ] Delivery governance separately records implementation, deployment, evidence, and status.

Completing this worksheet does not itself implement, deploy, activate, or complete D1-007.
