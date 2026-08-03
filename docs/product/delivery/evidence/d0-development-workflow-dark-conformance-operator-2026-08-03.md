# D0-016 SR-005 development workflow dark-conformance operator evidence

- Date: 2026-08-03
- Environment: Development AWS account in `us-east-2`
- Baseline source commit: `d952e93a2f98ca20497288d40e35aa52134685a2`
- Status: Operator and runbook implemented; read-only preflight passed; execution not authorized

## Completed-dark verifier

The existing guarded workflow planner now has a completed-deployment verification mode. It
reconstructs the exact live inputs and immutable artifacts from encrypted state, requires a
refresh-backed Terraform exit code of zero, rejects every non-no-op action, and rechecks the
disabled SQS/EventBridge triggers, exact artifacts/layer/concurrency, durable stack template, and
policy-hash propagation gate.

The live diagnostic from the synchronized baseline commit passed with zero creates, updates,
deletes, or replacements. All three workflow artifacts and the pinned layer revalidated; gateway
dispatch remained Temporal; replacement triggers remained disabled; and API/ECS capacity remained
unchanged. The ignored plan was not applied.

## Checksum-gated conformance operator

The new operator and runbook separate AWS-read planning from invocation. Plan mode binds an exact
source commit, operator hash, completed-dark plan hash, live aliases/code/concurrency, disabled
triggers, seven enabled `OK` alarms, empty terminal DLQ, complete durable stack, Cloud Map API
integration, stable ECS rollback services, and Temporal dispatch into one ignored context.

Execution requires the exact context checksum and clean merged `main`. It permits only four
synchronous synthetic invalid-input invocations:

- activity input rejection;
- starter partial-batch rejection;
- terminal-event rejection; and
- exact-version durable input rejection.

The reconciler is structurally excluded because it owns outbox writes. The synthetic payloads use
no candidate or operation data and reject before product-data mutation. The durable invocation is
synchronous so an expected failure cannot enter the asynchronous durable DLQ. The operator changes
no trigger, queue message, public route, ECS capacity, Terraform state, or dispatch target.

## Local and read-only evidence

- PowerShell help/parser checks pass for the planner and operator.
- Formatting, infrastructure-policy validation, and Terraform formatting pass.
- The read-only AWS preflight accepted the complete live boundary and produced a four-invocation
  diagnostic with no reconciler, product-data write, trigger, or traffic change.
- A wrong checksum and execution from uncommitted source both failed closed before invocation.
- The uncommitted diagnostic context was removed through its checksum-gated, live-revalidated
  cleanup path; cleanup performed no AWS mutation.

No function was invoked by this work. No account identifier, bucket, KMS identifier, function,
queue, role or service ARN, credential, token, provider value, state/plan content, context content,
or candidate data is retained here.

## Next gate

Merge the operator and verifier, synchronize exact `main`, rerun completed-dark verification, and
generate a fresh conformance context. A separate explicit authorization of that exact new checksum
is required before the four synthetic invocations. After execution, inspect privacy-safe aggregate
logs and alarms and rerun zero drift before accepting development dark conformance.
