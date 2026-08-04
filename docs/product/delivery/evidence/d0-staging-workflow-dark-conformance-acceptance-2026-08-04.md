# D0-016 staging workflow dark-conformance acceptance

- Date: 2026-08-04
- Environment: Isolated synthetic staging
- Status: Workflow dark conformance passed; human notification receipt remains pending
- Source commit: `ae91e4878cbd5af41024621a51308a499fbb83ec`
- Reviewed context SHA-256:
  `3cdeb6aca5542677d687ae663606b8c3c5211bd4b3c603972d5ac5d7680c2eff`
- Pre-execution zero-change plan SHA-256:
  `9d56b04ad1f4b1db0cbb3cbe12af1d7dcaa1bad8e44844ab6bca29b573d64646`

## Reviewed boundary

The exact clean upstream `main` commit produced a refresh-backed completed-dark plan with 123
resource changes represented only as `no-op` or read actions: zero creates, updates, deletes, or
replacements. The staging wrapper then created one ignored review context after independently
confirming:

- five healthy immutable workflow aliases with reserved concurrency `1/1/1/1/2`;
- the SQS event-source mapping and both EventBridge rules disabled;
- seven enabled workflow alarms in `OK`, each with one ALARM and one OK action;
- an empty durable DLQ and complete durable stack;
- retained gateway and worker ECS services idle at `0/0/0`;
- the existing API Gateway HTTP proxy still targeting Cloud Map/ECS; and
- gateway outbox dispatch still targeting Temporal.

The context limited execution to three synchronous invalid-input probes and one uniquely named
asynchronous invalid durable execution. It excluded the reconciler, product writes, product SQS
traffic, trigger enablement, public routing changes, ECS capacity changes, and candidate data.

## Execution and recovery

The checksum-authorized drill reached all four reviewed fail-closed paths. The activity and
starter rejected invalid payloads through their handled contracts, the terminal handler returned
its expected function failure, and the exact durable numeric version reached `FAILED` with
`WorkflowInputRejected`. Exactly one byte-identical synthetic durable message reached the DLQ and
was deleted by exact payload match.

Both owned alarms transitioned from `OK` to `ALARM`. The dead-letter alarm returned to `OK` after
the exact deletion. The local command host reached its six-minute output limit while the
durable-failure alarm was still evaluating recovery, after every invocation and the DLQ cleanup
had already completed. The operator was not rerun. Read-only recovery inspection instead proved:

- the uniquely named durable execution was singular, matched the reviewed version and payload,
  and remained in the expected `FAILED` state;
- the DLQ had zero visible, in-flight, or delayed messages; and
- both owned alarms subsequently reached `OK`.

The timeout exposed an AWS CLI recovery incompatibility: the durable-execution list API rejects a
name filter when a function qualifier is also supplied. The recovery lookup now filters by exact
function and reviewed execution name, then preserves version safety by comparing the fetched
execution's numeric version to the reviewed context. A repository policy assertion prevents the
invalid argument combination from returning.

Checksum-bound cleanup then found the exact failed execution, found no remaining matching DLQ
message, confirmed all seven alarms healthy, repeated the complete byte-identical live-boundary
comparison, and removed the ignored context. It did not stop an execution or delete another
message. No infrastructure, route, trigger, ECS, Temporal-dispatch, product, identity, or
candidate-data state changed.

Two earlier local launcher attempts were terminated during the read-only pre-execution boundary
audit because their command timeouts were too short. Neither reached an invocation, and the same
reviewed context remained intact; no automatic or duplicate retry was performed.

## Acceptance and next gate

Staging workflow dark conformance passes at the AWS state and alarm-transition layers. This record
does not yet claim human receipt of the expected durable-failure and dead-letter `ALARM`/`OK`
notification pairs. It also does not claim authenticated gateway acceptance, accepted-release
rollback/restoration, API/outbox cutover, Temporal retirement, or obsolete-resource removal.

After notification receipt is confirmed, continue SR-006 with the staging accepted-release
rollback/restoration and authenticated gateway/cross-user acceptance before preparing the
separately reviewed cutover plan.
