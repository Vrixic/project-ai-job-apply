# D1 Moderation and Representative-Assurance Decision Record

- Decision version: `d1-governance-v1`
- Product disposition: Accepted
- Accepted by: Repository product owner through delegated recommendation authority
- Decision date: 2026-08-27
- Scope: D1P-01 through D1P-08 and D1 representative development-assurance thresholds
- Revalidation: Required for any material identity, scope, lifecycle, retention, alert, source,
  workload-profile, or environment change

This is the single decision-and-rationale document for the Phase 1 moderation and representative-
assurance choices delegated by the product owner on 2026-08-27. It supersedes the empty worksheet
previously stored at this path. The product owner directed that the repository recommendations be
their decisions and authorized engineering to make the remaining choices, provided the choices and
their reasons remain together in one document.

Product acceptance here selects policy and development-assurance inputs. It does not itself create
an Auth0 client, grant a scope, identify or confirm an alert recipient, execute a hosted test,
approve real candidate data, publish public routes, establish a production SLO/RTO/RPO, or replace
the final independent security/privacy/accessibility review.

## Decision principles

1. Candidate reports are evidence for a human; they never automatically change job or source state.
2. Administrative authority is separate, minimal, short-lived, MFA-protected, and fully auditable.
3. A source can be paused exactly, but it cannot be resumed. Reactivation is a new ADR-025 activation.
4. Moderators see the smallest aggregate view needed to decide; reporter identity is not projected.
5. Candidate-linked data expires sooner than integrity and privileged-action proof.
6. D1 provider-catalog authority never grants D2 public-UGC authority.
7. Development assurance fails on any unexpected application failure, 5xx, Lambda error/throttle,
   privacy-log match, queue backlog, DLQ message, or Terraform drift.

## D1P moderation dispositions

### D1P-01 — Administrative identity and authority

Accepted decision:

- Use one dedicated Auth0 Regular Web Application for moderation. It must not be the candidate
  client and must use the existing exact API audience `ai-job-apply-api`.
- Request and grant exactly `openid profile jobs:moderate`. Candidate, profile, document, rights,
  billing, and offline/refresh scopes are prohibited.
- Require an MFA-authenticated `amr`, reauthentication after 15 minutes, a one-hour absolute
  server-held session, and no token storage in browser JavaScript.
- Use one MFA-protected generated-synthetic moderator for development acceptance. Before real
  reports, bind a named operations/trust owner, verify access before each activation and at least
  quarterly, and revoke immediately on role removal.
- Phase 1 has no break-glass path. The same accountable operator may open and resolve a case because
  decisions are version-fenced and append-only audited; a later production risk review may require
  two-person control for source pause.
- Every privileged action is constrained to the exact environment, job, case, and, where relevant,
  `sourceId + adapterVersion + adapterConfigSha256` tuple.

Rationale: one exact scope and short server-held sessions minimize privilege while preserving the
already implemented manual workflow. A second-person mechanism would add an unimplemented control
without improving the current generated-synthetic, prelaunch boundary.

### D1P-02 — Candidate/admin separation and minimum view

Accepted decision:

- Keep candidate and admin Vercel projects, Auth0 clients, sessions, and BFF route families separate.
- Deny candidate tokens at moderation routes and deny moderation-only tokens at candidate-owned
  routes unless the token separately carries that route's exact candidate scope.
- The ordinary moderation view contains only case state/version, job/source control identifiers,
  fixed reason-code counts, lifecycle/control state, timestamps, and opaque operator audit IDs.
- Do not project reporter identity, candidate profile, documents, preferences, saved jobs, rights
  records, email, support history, free text, provider payloads, or cross-job candidate linkage.
- Do not place moderation values in alerts, tickets, screenshots, analytics, or exports. Services
  expose allowlisted read models; the admin surface receives no direct-table access.

Rationale: aggregate reason codes are sufficient for the supported actions. Additional candidate
data would create privacy and authorization risk without improving a source-catalog decision.

### D1P-03 — Reports, case opening, review, and suppression

Accepted decision:

- Automatic case-opening and suppression thresholds are disabled in Phase 1.
- Reports remain immutable evidence. A human explicitly opens a case with one fixed reason code.
- A report, count, alert, or suspected-scam reason never automatically blocks a job or pauses a
  source. No job-unblock operation is authorized in Phase 1.
- `no_action` requires the reviewer to find insufficient corroborating catalog/provider evidence.
  `block_job` requires reviewed evidence that the exact job is closed, absent, materially inaccurate,
  fraudulent, duplicated, or otherwise violates the catalog boundary. `pause_source` additionally
  requires evidence that the exact configured source cannot currently preserve truthful ingestion.
- During a bounded development acceptance window, an opened case should be reviewed within one
  business day. This is an internal operating target, not a public promise or production SLA.

Rationale: report-volume thresholds are easy to brigade and the implemented aggregate is not an
identity-quality signal. Explicit human review is the simpler and safer D1 rule.

### D1P-04 — Exact source pause and reactivation

Accepted decision:

- A moderator may pause only the exact reviewed `sourceId + adapterVersion +
  adapterConfigSha256` tuple after evidence of source-integrity failure.
- Pause denies scheduled, resumed, recovered, claimed, and newly dispatched work for that tuple and
  creates append-only audit evidence.
- No resume endpoint, reverse decision, or break-glass resume is authorized.
- A paused source can return only through a new ADR-025 activation record with current source truth,
  configuration digest, release evidence, reconciliation evidence, and product/source-engineering
  approval.

Rationale: a new activation is clearer and safer than mutating historical pause evidence, and it
prevents stale work or an outdated configuration from inheriting authority.

### D1P-05 — Alerts, recipient, acknowledgement, and escalation

Accepted decision:

- Alert payloads contain only fixed event/reason codes, counts, state/version, environment, and
  opaque control identifiers. Candidate values, reporter identifiers, emails, URLs, descriptions,
  provider payloads, tokens, and secrets are prohibited.
- Alert-only thresholds are: any `suspected_scam` report; three reports for one canonical job in a
  rolling 24-hour window; any job block; any exact-source pause; any denied/failed privileged action;
  any pause-gate read failure or attempted execution of paused work; ten open cases; or an oldest
  open case older than one business day. Alerts never change lifecycle or source state.
- Bind exactly one confirmed operations/trust recipient for development. Store only the canonical
  recipient-set SHA-256 in acceptance evidence, never the recipient value.
- During an active acceptance window, acknowledge a security/source-pause alert within four business
  hours and all other moderation alerts within one business day. Escalate an unacknowledged alert to
  the product owner at the next boundary. No 24/7 coverage is claimed.

Rationale: the thresholds flag concentrated or safety-relevant evidence without granting automated
authority. One confirmed recipient is sufficient for prelaunch development and makes delivery
verification unambiguous.

### D1P-06 — Retention, deletion, export, and privileged audit

Accepted decision:

| Record | Selected active retention | End-of-retention treatment |
|---|---|---|
| Candidate report and reporter link | 90 days from receipt or 30 days after its linked case closes, whichever is later | Irreversibly remove the reporter link and report-level request hash; retain only non-identifying aggregate/integrity proof |
| Report idempotency material | Same bound as the candidate report, never longer than 90 days when no case exists | Delete |
| Moderation case and decision event | 365 days after case closure | Delete case detail; retain only minimal non-PII integrity/tombstone proof if still needed for catalog correctness |
| Job/source tombstone and control evidence | 365 days after the last relevant action | Delete unless the current catalog still requires the tombstone to prevent resurrection |
| Privileged access/action audit | 365 days | Delete or retain only non-PII aggregate security proof |
| Alert/incident delivery metadata | 30 days | Delete; retain the accepted aggregate evidence record |
| Export artifact | 3,600 seconds with a 300-second exact-version download grant in generated-synthetic development | Exact-version deletion; final real-user policy remains part of the deferred rights review |

- An authenticated candidate export includes the candidate's still-linked report reason/status and
  relevant audit metadata, but never operator identity, other reporters, provider payloads, tokens,
  or secrets.
- Confirmed candidate deletion immediately denies active access and removes the reporter link. Any
  allowed completion proof must be non-PII. Restores must replay the deletion ledger before service.
- Inaccessible backup copies age out within the selected 35-day window and cannot restore an account.
- Phase 1 has no legal-hold mechanism. A requirement for one blocks real-data activation until a
  separately reviewed implementation exists.

Rationale: 90 days supports duplicate/abuse investigation without indefinitely retaining a link to
a reporter; 365 days preserves bounded privileged-integrity evidence; short alert and export windows
reduce unnecessary copies. The 35-day backup rule stays consistent with the selected rights policy.

### D1P-07 — Correction, takedown, and appeal

Accepted decision:

- Candidates use the authenticated fixed-reason report flow. A verified employer/provider
  representative uses the separately controlled operations/trust channel; the exact address is not
  stored in source or evidence.
- Verify an employer/provider requester through a company-domain identity plus corroboration against
  the public source record. Do not accept possession of a URL as identity proof.
- Acknowledge ordinary requests within one business day and decide within five business days.
  Acknowledge a credible urgent safety/scam request within four business hours during active
  operations. These are internal prelaunch targets, not public promises.
- Pending requests do not automatically suppress content. The first reviewer uses the fixed D1
  decision codes and evidence rules. One appeal is allowed within 14 days with new or corrected
  evidence and must be handled by a different reviewer.
- A correction or reversal that requires restoring a blocked job or paused source is not performed
  in place: job truth is re-observed through the canonical lifecycle, and source return requires a
  new ADR-025 activation record.

Rationale: authenticated, evidence-bound intake avoids an arbitrary support surface while giving
affected parties a review path. A second-review appeal limits conflicts without creating an
unbounded case-management product.

### D1P-08 — D1 provider catalog versus D2 public UGC

Accepted decision:

- D1 covers candidate reports about provider-fed canonical jobs and manual controls for those jobs
  and exact sources only.
- Public contribution intake, contributor identity/reputation/reward/sanction, UGC licensing,
  extension collection, and UGC takedown/appeal remain D2-owned and unstarted.
- D1 scopes, clients, queues, read models, retention rules, audit, and decisions grant no D2
  authority. A future shared shell still requires separate D2 contracts and authorization.

Rationale: provider truth and public contribution have different authority, consent, abuse, and
retention boundaries and must not be conflated.

## Representative development-assurance decision

The following exact values are accepted for the existing fixed, generated-synthetic development
profiles. They are release-acceptance ceilings, not forecasts, capacity claims, or production SLOs.

```json
{
  "concurrency": { "read": 2, "savedJob": 1, "match": 1, "providerFailure": 1 },
  "durationMs": {
    "read": 30000,
    "savedJob": 10000,
    "match": 5000,
    "providerFailure": 900000,
    "recovery": 3600000,
    "alertTransition": 600000
  },
  "latencyMs": {
    "publicP95": 250,
    "authenticatedP95": 350,
    "apiAverage": 500,
    "apiMaximum": 3000,
    "lambdaMaximum": 5000
  },
  "errors": {
    "maxApplicationFailures": 0,
    "maxApi5xx": 0,
    "maxLambdaErrors": 0,
    "maxLambdaThrottles": 0,
    "maxErrorLogMatches": 0,
    "maxForbiddenLogMatches": 0
  },
  "queues": {
    "maxOldestAgeSeconds": 0,
    "maxVisible": 0,
    "maxEventDlq": 0,
    "maxDurableDlq": 0
  },
  "alerts": {
    "expectedWorkloadAlarmCount": 10,
    "expectedPlatformAlarmCount": 43,
    "expectedConfirmedRecipientCount": 1,
    "reviewedRecipientSetSha256": "SUPPLIED_BY_THE_ALERT_OPERATOR_AFTER_RECIPIENT_CONFIRMATION"
  }
}
```

Rationale:

- Concurrency matches the fixed workload implementations: two-way read and single-flight mutation,
  match, and provider-failure profiles.
- The application ceilings preserve material headroom over the accepted observations (read 12.894
  seconds, saved job 2.204 seconds, match 0.895 seconds; public/authenticated p95 78/111 ms) without
  turning one bounded run into a capacity claim.
- The 15-minute provider-failure ceiling covers the accepted bounded recovery fixture; the one-hour
  database recovery ceiling covers the accepted 2,224-second current recovery and 3,281-second
  earlier recovery measurements.
- Zero error, privacy-log, backlog, DLQ, and drift tolerance is appropriate for an acceptance run
  designed to clean up completely. Ten healthy alarms bind each fixed workload inspector, while 43
  healthy alarms bind the complete managed platform status used by alert-delivery acceptance. The
  counts are intentionally separate because they measure different inventories.
- The recipient value remains outside source. On 2026-08-27 the alert operator found exactly one
  confirmed email recipient, zero pending recipients, calculated its canonical-set digest, and bound
  only that digest in ignored private acceptance evidence. The operator must re-verify the same
  digest immediately before the manual delivery exercise.

## Authorization and remaining execution gates

The product decisions above authorize engineering to configure and test the bounded generated-
synthetic development paths. The following states remain false until their evidence exists:

- real candidate reports or documents;
- public route, sitemap, or indexing activation;
- production source cadence or source reactivation;
- automatic job/source lifecycle changes;
- D2 public UGC behavior; and
- Phase 1 completion.

Remaining execution gates are:

1. create/configure the distinct admin Auth0 client and exact `jobs:moderate` grant;
2. enroll one disposable MFA-protected moderator and run hosted admin acceptance;
3. manually confirm one ALARM and one recovery delivery for the already-bound operations/trust
   recipient set;
4. rerun the representative assessor against the already-reviewed private release configuration;
   and
5. complete the separately deferred final human reviews.

Execution evidence may link this record but must not duplicate or fork these policy and threshold
decisions. A material change updates this one document to a new decision version and requires new
product acceptance.
