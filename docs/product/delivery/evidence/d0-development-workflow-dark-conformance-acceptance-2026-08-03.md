# D0-016 development workflow dark-conformance acceptance evidence

- Date: 2026-08-03
- Environment: Development AWS account in `us-east-2`
- Source commit: `8b38af2d568c04ebfcd34de6b2e7e82b39d63cd4`
- Authorized context SHA-256: `d991525aee9a41067094dc40667b85e093d25c7bd9a522a475a43433d1888e2f`
- Pre-execution zero-drift plan SHA-256: `db63b2b5d3221195453ccc0c8b78e3720d04ab4252dddcb9f9f7279a5607f2d3`
- Post-execution zero-drift plan SHA-256: `1f348e8358abbf4fc8fd2c1c20e8c82a284bdc54cf6c90a7c181c16ae6a2f28b`
- Status: Development dark conformance passed

## Authorized execution

The product owner authorized the exact checksum after reviewing its bounded mutation: three
synchronous synthetic rejection probes, one exact-version asynchronous durable rejection, one
expected synthetic DLQ message and byte-exact deletion, and four expected alarm transitions.

The exact clean merged source, refresh-backed zero drift, five healthy immutable aliases, bounded
concurrency, disabled SQS/EventBridge triggers, seven enabled `OK` alarms, empty durable DLQ,
complete durable stack, stable ECS rollback, unchanged API routing, and Temporal dispatch all
passed before invocation.

All four reviewed probes passed. The activity returned its handled invalid-input result, the
starter returned the exact partial-batch rejection, the terminal handler produced its expected
rejection error, and the uniquely named exact durable version reached `FAILED` with the reviewed
non-retryable invalid-input boundary. The operator deleted exactly one byte-identical synthetic
DLQ message and removed its checksum context after recovery.

No reconciler, product-data write, product SQS event, trigger enablement, public-route change,
ECS-capacity change, Terraform apply, or real outbox workflow occurred.

## Observability and recovery

CloudWatch history in the bounded post-run window shows exactly one `ALARM` and one `OK` transition
for each owned alarm: durable failure and durable dead letter. All seven workflow alarms were then
enabled and `OK`, and visible, in-flight, and delayed DLQ depth returned to zero.

Aggregate-only log inspection retained no messages or identifiers. The 20-minute window contained
one expected unclassified `ERROR` from terminal rejection, six unclassified non-error records,
120 gateway informational records, and 40 workflow-worker informational records. The product owner
confirmed receipt of all four expected notifications: `ALARM` and `OK` for durable failure, plus
`ALARM` and `OK` for the durable dead letter. No destination or message content is retained.

## Post-run boundary

The second exact-main refresh-backed Terraform plan contained zero creates, updates, deletes, or
replacements. Immutable artifacts and the pinned extension passed, replacement triggers remained
disabled, API traffic remained on ECS, ECS capacity remained unchanged, and dispatch remained on
Temporal. The ignored conformance context no longer exists.

This closes development workflow dark conformance only. It does not authorize public cutover,
normal outbox triggers, ECS/Temporal retirement, staging deployment, or D0-016 completion. The next
SR-005 gate is a separately reviewed known-good workflow release rollback drill.

No account identifier, ARN, bucket/object, KMS identifier, credential, token, OIDC or Temporal
value, raw payload/error/log, state/plan/context content, or candidate data is retained here.
