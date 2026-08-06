# Staging post-cutover legacy drain source — 2026-08-06

## Finding

A fresh exact-current staging runtime-baseline review stopped before Terraform planning because the
official outbox preflight found three unpublished records. The identifier-free inspection reported
three pending records, zero attempts, and an oldest creation time of
`2026-08-06T06:02:03.696Z`. The aggregate identifier digest was used transiently by the operator
and is not retained here.

The scheduled reconciler remained enabled and healthy. Aggregate logs showed that it had recovered
from the earlier encrypted-queue producer failure, successfully sent the eligible Lambda-durable
record, and subsequently claimed zero work. A separate read-only, identifier-free database
aggregate proved that all three remaining unpublished records have the stored dispatch target
`temporal`; therefore the Lambda-durable reconciler correctly does not claim them.

Two preliminary diagnostic tasks stopped before opening a database connection because their
container invocation/import shape was invalid. A third immutable on-demand task used a read-only
transaction and returned only dispatch target, count, and oldest timestamp. All diagnostic tasks
stopped. No event ID, operation ID, candidate value, account identifier, endpoint, secret, or
resource identifier is retained in this evidence.

The records were created during the staging acceptance window. Their exact writer cause has not
been proven and is not assumed here. The stored dispatch target is sufficient to select the safe
recovery path without rewriting or deleting product records.

## Safety gap and correction

The existing checksum-gated legacy Temporal drain was intentionally limited to the pre-cutover
boundary: Temporal dispatch, disabled replacement triggers, and the retained ECS HTTP API route.
It correctly refused the accepted post-cutover state, where new work uses Lambda durable dispatch,
the Lambda/JWT API is public, and the durable triggers are enabled.

Source now adds an explicit `PostCutover` runtime boundary. That mode requires an operator
zero-traffic assertion and binds the reviewed context to:

- the accepted immutable gateway Lambda alias and `lambda_durable` dispatch;
- exactly one retained ECS integration plus one Lambda proxy integration;
- one JWT default route requiring `profile:read` and `profile:write`, two anonymous health routes,
  and the gateway's exact OIDC issuer/audience authorizer;
- the enabled partial-batch SQS starter and both enabled EventBridge rules;
- the immutable retained Temporal worker and both ECS services at `0/0/0`;
- empty source/DLQ queues, seven routed healthy workflow alarms, and zero open Temporal workflows;
  and
- the exact three-record, zero-attempt, identifier-free aggregate.

Execution remains separately checksum authorized. It may start only one retained standalone
Temporal worker, does not alter public routing or durable triggers, fails on boundary drift or new
aggregate work, stops the task in `finally`, and requires both the outbox and Temporal namespace to
reach a double-checked terminal state. The pre-cutover mode remains available and unchanged in
intent. Static repository policy now requires both modes and their post-cutover protections.

## Current result and next gate

This change is source, runbook, policy, and delivery-record work only. No drain context was saved,
no Temporal worker was started, no product record transitioned, and no persistent AWS resource was
changed.

After merge, the next sequence is:

1. refresh the isolated staging session and reconfirm zero interactive traffic;
2. create a post-cutover drain review context from clean exact `main`;
3. inspect and separately authorize its exact checksum;
4. execute the bounded drain and prove zero remaining outbox/open Temporal work with the complete
   serverless boundary unchanged; and
5. generate the fresh zero-change runtime baseline required before rollback/restoration.

SR-006 and D0-016 remain `In progress`.
