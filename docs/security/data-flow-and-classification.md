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

## Required delta data-flow diagrams

The Phase 0 diagram is not evidence for an unimplemented capability. Before activation, add and
approve a diagram for:

- resume parsing and AI-assisted tailoring;
- public source ingestion and UGC contribution;
- extension active-tab extraction;
- ATS autofill/submission;
- remote browser and user takeover;
- outreach OAuth and sending;
- billing/mobile/push; and
- export, deletion, incident, and backup-restore paths in deployed environments.

### D1 resume intake and deterministic parsing design

This is a source design until its exact resources and synthetic deployment evidence are recorded.

```mermaid
flowchart LR
  Candidate3[Candidate browser] -->|metadata + owner session| ResumeAPI[Candidate resume API]
  ResumeAPI -->|document ID + exact upload grant| Candidate3
  ResumeAPI -->|owner-scoped metadata| DocumentsDB[(Documents schema)]
  Candidate3 -->|bounded presigned POST| Quarantine[(Private KMS S3 quarantine)]
  Quarantine --> GuardDuty[GuardDuty malware scan]
  GuardDuty -->|identifier + disposition only| ScanEvents[EventBridge → encrypted SQS]
  ScanEvents --> Processor[Private document processor]
  Processor -->|tag + magic/size/archive verification| Quarantine
  Processor -->|normalized encrypted tree| Normalized[(Private KMS S3 normalized prefix)]
  Processor -->|status + object refs only| DocumentsDB
  DocumentsDB -->|proposals + supporting spans| Candidate3
```

Resume bytes and extracted text exist only in the candidate device, quarantined/normalized object
storage, and bounded processor memory. Events carry the bucket/object version and opaque document
identity only. Telemetry records states, counts, byte/page/character totals, error codes, and
opaque IDs without filenames, candidate values, object contents, or identity-provider subjects.

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
