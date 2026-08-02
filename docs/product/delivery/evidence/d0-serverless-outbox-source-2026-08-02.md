# D0 Serverless Outbox Source Evidence — 2026-08-02

- Scope: D0-016 / SR-003 source, contracts, tests, artifact, and disabled infrastructure
- Environment: Local repository only
- Cloud mutation: None
- Public traffic change: None
- Runtime route: Existing ECS gateway and Temporal worker remain authoritative
- Status: Locally complete; reviewed cloud deployment remains open under SR-004/SR-005

## Implemented boundary

The transactional outbox now assigns every event one immutable dispatch target. Existing rows and
all existing compositions default to `temporal`; only rows explicitly created as
`lambda_durable` are eligible for SQS reconciliation or starter processing. The live Temporal
dispatcher selects only `temporal` rows. This routing invariant prevents one event from being
started by both engines during the later cutover.

Migration `0002_serverless_outbox` adds forward-only nudge, claim, retry, durable-start, and
sanitized error metadata plus partial indexes for undispatched Lambda work. The normal write still
commits profile state, operation, audit, idempotent response, and identifier-only event in one
transaction. An optional post-commit SQS send cannot roll that transaction back; unsuccessful
sends remain eligible for scheduled reconciliation.

The versioned `platform.outbox.nudge.v1` SQS contract contains only:

- schema version;
- immutable event ID and type;
- optional W3C trace context; and
- deterministic SHA-256 integrity metadata.

The starter reloads authoritative event data from PostgreSQL, validates the message and domain
event, derives one execution name from the event ID, invokes one exact published durable-function
version asynchronously, and acknowledges the outbox only after AWS returns acceptance. SQS partial
batch responses isolate failed records. Duplicate, reordered, and post-start/pre-ack crash tests
converge on one effective execution identity.

The reconciler claims a bounded oldest page with `FOR UPDATE SKIP LOCKED`, uses a reclaimable lease,
records sanitized attempt/error metadata, and schedules later resend rather than holding a database
transaction across SQS I/O.

## Disabled infrastructure source

Terraform defines separate least-privilege starter and reconciler roles, one-concurrency versioned
Lambda aliases, private Secrets Manager/SQS/Lambda interface endpoints, the existing KMS-encrypted
queue and DLQ, partial-batch event-source mapping, disabled one-minute recovery schedule, and
Lambda error/throttle alarms. Both triggers are explicitly disabled. The gateway dispatch input
defaults to `temporal`; selecting `lambda_durable` is rejected unless the replacement boundary is
enabled.

The serverless-outbox deployment input additionally requires an exact numeric-version durable
function ARN. SR-004 has not produced that function, so no deployable cloud plan or apply is claimed.

## Local verification

Passed:

- strict event-contract validation, including unrestricted-field rejection;
- profile, gateway, and workflow source tests;
- TypeScript builds and focused type checks;
- crash-after-accepted-start, duplicate, reorder, partial-batch, failed-send, and oldest-page
  regression tests;
- two consecutive workflow-ingress Lambda builds with the same ZIP SHA-256, manifest, and
  CycloneDX component inventory;
- Terraform 1.9.8 / AWS provider 6.57.1 validation for the shared platform module, development,
  and staging compositions.
- real PostgreSQL 16 integration: forward migration apply/replay, post-commit failed-send
  durability, `SKIP LOCKED` disjoint claims, and 26-row oldest-page advancement.

## Non-claims and next gate

- No migration was run in AWS.
- No artifact was published.
- No SQS mapping, EventBridge rule, Lambda, endpoint, IAM policy, alarm, gateway setting, or event
  route was created or changed in AWS.
- No durable workflow exists yet.
- ECS and Temporal cannot be retired from this evidence.

Next: merge the source, implement SR-004's exact versioned durable function, and only then generate
a refresh-backed, no-route-change dark plan for separate review under SR-005.
