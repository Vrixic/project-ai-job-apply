# Data Flow and Classification

- Status: Engineering baseline; accountable security/privacy approval pending
- Last updated: 2026-08-08

The deployed Phase 0 runtime follows this serverless flow:

```mermaid
flowchart LR
  User2[Candidate device] -->|OIDC token + contract data| Edge2[API Gateway + Lambda gateway]
  Edge2 -->|transaction| PG2[(PostgreSQL)]
  PG2 -->|identifier-only outbox row| Nudge[SQS nudge]
  Nudge --> Starter[Starter Lambda]
  Starter -->|exact version + stable execution name| Durable[Lambda durable orchestrator]
  Durable -->|opaque IDs only| Activity[Private activity Lambda]
  Activity -->|secret fetched privately + TLS| PG2
  Durable -->|checkpoint state| KMS[Lambda durable store + CMK]
  Durable -->|failed identifier-only input| DLQ[Encrypted DLQ]
  Durable -.->|failed/stopped/timed-out status| Terminal
  Terminal[Private terminal reconciler] -->|idempotent result| PG2
```

Only the activity and terminal handlers enter the VPC or read the database secret. The durable
orchestrator receives opaque identifiers, runs outside the VPC, invokes one immutable numeric
activity version, and uses a separate CMK boundary for durable checkpoints. SQS, reconciliation,
and terminal-event triggers activate together behind one fail-closed runtime switch.

The Phase 0 slice does not call ATS, AI, email, calendar, billing, or browser-automation providers.

| Class | Examples | Required controls | Forbidden destinations |
|---|---|---|---|
| Public | Public job text, company URL | Provenance, integrity, sanitization | None |
| Internal | Operation state, match features, opaque IDs | Authorization, encryption, audit | Public responses without ownership |
| Confidential PII | Email, resume, history, preferences | TLS, KMS, owner-scoped access, redacted telemetry | Events, fixtures, analytics, logs |
| Restricted | OAuth/session tokens, sensitive answers | Separate secrets/keys, just-in-time access, mandatory audit | Logs, analytics, fixtures, general events |

## Phase 0 preference flow

- JWT subject and issuer resolve to an internal UUID; provider subjects never become public IDs.
- Preference values remain in the profile-owned PostgreSQL schema.
- The outbox carries only preference-set ID, version, operation ID, and trace correlation.
- The private activity Lambda reloads the owned record, calculates deterministic readiness, and
  persists the result.
- Audit events record action, opaque resource ID, version, and trace ID—not candidate values.

## Ownership and recipient matrix

| Boundary/data | System of record/owner | Permitted recipients | Release gate |
|---|---|---|---|
| Identity mapping and sessions | Identity bounded context; managed OIDC for credentials | Gateway verifier, audited identity operations | Managed-provider security/privacy review |
| Candidate facts, preferences, answer metadata | Profile bounded context | Candidate, application service through versioned contract | Real-data onboarding approval |
| Resume and generated documents | Document/application bounded context; encrypted object storage | Candidate, approved renderer/model/ATS workflow only | AI/provider and application delta approval |
| Public jobs and provenance | Catalog bounded context | Public clients/search after source policy | Per-source legal approval |
| Contribution and contributor link | Trust/UGC bounded context | Moderation operations; public catalog excludes identity | UGC/extension approval |
| Application packet/approval/attempt | Application bounded context | Candidate and authorized workflow/adapter | ATS/application approval |
| Restricted tokens/session/sensitive answers | Dedicated restricted boundary and secrets/object stores | Just-in-time authorized worker only | Provider/remote/outreach approval |
| Billing identity/entitlement | Billing bounded context | Candidate, entitlement checks, approved billing provider | Billing/store approval |
| Audit evidence | Security/audit owner | Least-privilege security/support operations | Admin-access and retention approval |
| Operational telemetry | Platform/observability owner | Approved monitoring provider and on-call roles | Redaction/access/retention verification |

### D1 candidate job-report and moderation source boundary

```mermaid
flowchart LR
  CandidateReport[Authenticated candidate] -->|job ID + fixed reason + idempotency key| GatewayReport[Gateway jobs:write route]
  GatewayReport -->|internal owner UUID + fixed command| JobsReport[Jobs report store]
  JobsReport -->|owner-isolated immutable row| JobsDB[(Jobs schema)]
  JobsDB -->|fixed-code aggregate only| InternalReview[Scoped human moderation console]
  InternalReview -->|explicit block or exact source pause decision| ModerationLedger[Append-only moderation ledger]
  ModerationLedger -->|exact source adapter config pause| IngestionGate[Fail-closed ingestion execution gate]
  IngestionGate -->|permit only while unpaused| SyntheticRuntime[Default-off synthetic ingestion runtime]
```

The report contract contains no free text, provider identity, source URL, candidate values, or
moderation outcome. Exact replay is owner-scoped, and aggregate review does not expose reporter
identities. The dedicated admin client requests only `jobs:moderate`; the gateway derives a stable
opaque audit identifier from the validated issuer and subject and never exposes either raw claim
or the derived identifier to the browser. A report never changes lifecycle automatically. Only an
explicit version-fenced internal decision can block a job or persist a source pause; there is no
source-resume operation in this slice. This is locally verified source only. The durable synthetic
runtime reads the exact pause before
schedule/resume, attempt execution, polling, and subsequent catalog writes while preserving
terminal reconciliation. One already issued idempotent catalog write may finish before the next
gate check. The admin API/UI and dedicated scope are implemented locally, but no managed-OIDC admin
grant, source resume, real reports, retention/deletion approval, alerting policy, database apply,
deployment, or live acceptance is claimed.

## Required delta data-flow diagrams

The Phase 0 diagram is not evidence for an unimplemented capability. Before activation, add and
approve a diagram for:

- resume parsing and AI-assisted tailoring;
- public source ingestion and UGC contribution;
- extension active-tab extraction;
- ATS autofill/submission;
- remote browser and user takeover;
- outreach OAuth and sending;
- billing-provider/mobile/push; and
- export, deletion, incident, and backup-restore paths in deployed environments.

### D1 resume intake and deterministic parsing design

The intake boundary is deployed in development. The processing boundary below is locally verified
and remains dark until its exact artifacts, migration, infrastructure, and synthetic deployment
evidence are recorded.

```mermaid
flowchart LR
  Candidate3[Candidate browser] -->|metadata + owner session| ResumeAPI[Candidate resume API]
  ResumeAPI -->|document ID + exact upload grant| Candidate3
  ResumeAPI -->|owner-scoped metadata| DocumentsDB[(Documents schema)]
  Candidate3 -->|bounded presigned POST| Quarantine[(Private KMS S3 quarantine)]
  Quarantine --> GuardDuty[GuardDuty malware scan]
  GuardDuty -->|identifier + disposition only| ScanEvents[EventBridge → encrypted SQS]
  ScanEvents --> Coordinator[Private coordinator Lambda]
  Coordinator -->|15-minute exact-object capability| STS[Private STS endpoint]
  Coordinator -->|exact numeric invocation; identifiers + scoped capability| Parser[No-DB parser Lambda]
  Parser -->|exact tag + metadata + magic/size/archive verification| Quarantine
  Parser -->|deterministic encrypted tree| Normalized[(Private KMS S3 normalized prefix)]
  Coordinator -->|verify exact normalized version| Normalized
  Coordinator -->|status + object refs only| DocumentsDB
  Coordinator -->|atomic import port| ProfileDB[(Profile proposed facts + immutable spans)]
  ProfileDB -->|owner-scoped explicit review| Candidate3
```

Resume bytes and extracted text exist only in the candidate device, quarantined/normalized object
storage, and bounded processor memory. Events carry the bucket/object version and opaque document
identity only. Telemetry records states, counts, byte/page/character totals, error codes, and
opaque IDs without filenames, candidate values, object contents, or identity-provider subjects.
The parser has no database secret, direct S3 role permission, application-log permission, trace
permission, or routed internet path. Its temporary session is the intersection of a bounded base
role and an inline exact-version/exact-output policy. AWS-managed DNS remains reachable and is a
documented covert-channel risk, so the processing triggers remain synthetic-only until the exact
deployed boundary and DNS treatment receive accountable review. The coordinator has database
access but never receives or parses source bytes. Event validation binds the exact AWS account,
region, GuardDuty protection-plan ARN, bucket, key pattern, and object version.

### D1 provider-neutral entitlement read design

This is a source and local-test boundary only. No Auth0/Terraform route change, migration-image
publication, AWS deployment, provider/payment integration, price, quota, paid-only feature,
webhook, or real billing data is included.

```mermaid
flowchart LR
  Candidate4[Candidate browser] -->|server-held session; bodyless self-read| EntitlementBFF[Web entitlement BFF]
  EntitlementBFF -->|validated candidate token| Gateway4[Candidate gateway]
  Gateway4 -->|issuer + subject| ProfileIdentity[Profile identity mapping]
  ProfileIdentity -->|internal user UUID only| Gateway4
  Gateway4 -->|internal UUID + server clock only| EntitlementRead[Billing entitlement evaluator/cache]
  EntitlementRead -->|owner-scoped schedule read| BillingDB[(Billing schema)]
  EntitlementRead -->|derived plan/state/grants/version/times only| Gateway4
  Gateway4 -->|no-store derived status| EntitlementBFF
  EntitlementBFF -->|no-store derived status| Candidate4
```

Billing never receives the identity-provider issuer, subject, email, browser-supplied owner, or
payment/provider payload. The gateway exposes no Billing account ID or internal user ID. Invalid
schedules, ownership mismatches, and unavailable Billing reads become one generic `503`. A bounded
warm-process owner-keyed cache can retain eligible Pro access only through its exact access/grace
boundary after a Billing-reader failure; Profile identity resolution still precedes the cache, so
this does not prove availability through a total identity/database outage.

### D1 owner-self match-assessment design

This is a source and local-test boundary only. Jobs migration `0007`, the gateway release, and the
web UI are not deployed or accepted through a managed-OIDC browser session.

```mermaid
flowchart LR
  Candidate5[Candidate browser] -->|server-held session; job UUID only| MatchBFF[Web match BFF]
  MatchBFF -->|validated jobs:read token| Gateway5[Candidate gateway]
  Gateway5 -->|issuer + subject| ProfileIdentity5[Profile identity mapping]
  ProfileIdentity5 -->|internal user UUID only| Gateway5
  Gateway5 -->|internal UUID only| Preferences5[(Profile owner preferences)]
  Gateway5 -->|requested job UUID + trusted time| Jobs5[(Jobs active match projection)]
  Preferences5 --> Match5[Matching deterministic assessment]
  Jobs5 --> Match5
  Match5 -->|fixed codes + opaque identities/versions only| Gateway5
  Gateway5 -->|no-store| MatchBFF
  MatchBFF -->|fixed candidate-safe copy| Candidate5
```

Matching receives the owner-scoped preference snapshot and a Jobs allowlist containing no
description, company, source, provenance, raw content, or lifecycle reason. The response contains
no preference or job display values, restricted sponsorship value, score, rank, generated prose,
eligibility decision, or application outcome. A legacy sponsorship field blocks assessment for
review regardless of its boolean value. Unknown evidence never becomes a conflict, assessments are
not persisted or cached, and target expiry is rechecked after both reads complete.

## Rights-flow design boundary

Export and account deletion are not implemented by the Phase 0 slice. The following diagrams define
the minimum trust boundaries that an owning delivery must implement, update with exact deployed
components, and test before real candidate onboarding. They are not deployed-flow evidence.

### Authenticated export

```mermaid
flowchart LR
  Candidate[Candidate] -->|fresh authentication + export request| RightsAPI[Candidate rights API]
  RightsAPI -->|owner ID + request ID only| ExportFlow[Durable export workflow]
  ExportFlow --> OwnedStores[(Module-owned records)]
  ExportFlow --> ProviderLedger[Approved subprocessor ledger]
  OwnedStores --> Builder[Allowlisted export builder]
  ProviderLedger --> Builder
  Builder -->|encrypted, short lived| ExportObject[(Private object)]
  ExportObject -->|single-user, exact-object access| Candidate
  ExportFlow --> Audit[Opaque audit event]
```

The implementation must exclude credentials and restricted secret material, prevent cross-user
selection, define the portable schema, expire and delete the export object, audit access without
copying exported values, and fail closed when ownership or provider reconciliation is incomplete.

### Confirmed account deletion

```mermaid
flowchart LR
  Candidate2[Candidate] -->|fresh authentication + irreversible confirmation| DeleteAPI[Candidate rights API]
  DeleteAPI --> Quarantine[Quarantine identity and new effects]
  Quarantine --> DeleteFlow[Durable deletion workflow]
  DeleteFlow --> Revoke[Revoke sessions, OAuth, delegated credentials]
  DeleteFlow --> Modules[Delete or detach module-owned rows and objects]
  DeleteFlow --> Copies[Remove cache, search, analytics, support copies]
  DeleteFlow --> Providers[Send and reconcile subprocessor deletion]
  DeleteFlow --> Ledger[Minimal non-PII completion + backup-aging ledger]
  Backup[(Encrypted PITR backups)] -->|never serve before ledger replay| Ledger
```

The implementation must block login and queued external effects before erasure, account for every
owned store and provider, prevent ordinary recovery after confirmation, replay the deletion ledger
before a restored database serves traffic, and expose an honest `backup-expired` state. A provider
acknowledgement or expired backup window cannot be assumed from elapsed time alone.

### Anonymous public job detail

```mermaid
flowchart LR
  Browser[Anonymous browser or crawler] -->|exact GET, no identity| Web[Canonical Next job page]
  Web -->|no cookies or authorization| Reader[Dedicated public-job Lambda]
  Reader -->|IAM DB auth, one security-definer function| Jobs[(Jobs public projection)]
```

Only the requested/canonical public UUIDs, reversible-alias flag, company display name, title,
locations, optional department, plain-text description, and bounded
observation/verification/expiry timestamps cross this boundary. Candidate data, provider/source
URLs and identifiers, raw snapshots, moderation/audit fields, verified domains, search cursors,
and database credentials do not. Warm caches contain only the same projection or generic absence
and never serve stale data after a read error. Crawlability remains off by default. The Lambda
role's exact-key KMS decrypt grant supports automatic environment decryption only; an
explicit source-function condition denies KMS decrypt calls from the anonymous function code.
The migration
proves table/schema/temp least privilege inside the application database and defaults the dedicated
session to read-only, but it does not revoke PostgreSQL cluster-global PUBLIC catalog-function or
other-database privileges. `public_job_cluster_residual_accepted` therefore remains false by
default and keeps the route absent until accountable review accepts or remediates both residual
classes, or approves a stronger cluster/proxy boundary. The database-local read-only setting is
defense in depth rather than an immutable denial of those catalog capabilities.
