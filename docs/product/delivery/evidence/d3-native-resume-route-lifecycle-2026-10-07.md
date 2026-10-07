# D3 checkpointed resume route lifecycle - 2026-10-07

D3-064/D3-079 remain In progress. The new private
[lifecycle component](../../../../backend/workflows/src/native-resume-route-lifecycle.ts) connects
original route capture, DNS, owner-checked attachment and cleanup using the existing durable SDK.
It is not yet composed into the preparation Lambda or deployed. ADR-040 remains Proposed.

## Implemented flow

An owning capture port supplies the original allocation's validated route intent and expiry.
The first durable step checkpoints only those scalar values. A creation step repeats current
owner admission and expiry, then executes the original DNS create once. Creation uses the
installed SDK's `StepSemantics.AtMostOncePerRetry` together with a no-retry strategy. Both are
necessary: [AWS documents these semantics](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/).
The SDK commits START before that step's callback. Interrupted steps become unresolved rather
than repeating the write; this is not an exactly-once success guarantee.

Separate bounded steps poll the original change ID and exact record. Only propagated presence
permits the owning idempotent attachment port, with fresh admission/expiry checks. The workflow
then observes positive task retirement or original expiry and performs one exact DNS deletion.
Deletion must propagate and the original record must be absent before returning `removed`.
That result concerns authoritative DNS only, not task death, remote caches or all-copy deletion.
Clock and external I/O decisions occur inside checkpointed steps; waits do not renew expiry.

Unknown creation can be cleaned up only after positive original record presence. Missing DNS
cannot prove an unknown creator will not arrive later. Unknown deletion remains unresolved even
if it may have taken effect. Failed attachment acknowledgement remains unresolved while DNS
cleanup continues. Withdrawing new creation retains original cleanup while the runtime gate is on.

The component requires exactly one original named execution bound to the owning allocation.
It is not safe to expose it as a freely callable workflow or start a second execution to recover
unknown work. Terminal unresolved execution checkpoints need retained-version reconciliation.
The current source does not implement that operator or certify complete recovery.

## Local verification

- Documents and Workflows TypeScript builds pass; focused Biome checks pass.
- Fifteen new lifecycle tests and seven existing resume durable tests pass (22 total).
  The connected test uses the actual durable SDK runner and actual DNS adapter, with simulated
  Route 53 responses and owning ports. Checkpoint replay crosses multiple invocations and does
  not recapture intent or repeat DNS creation/deletion. No real AWS or SQL run is claimed.
- Cases cover creation shutdown, current owner refusal/outage, lost mutation acknowledgements,
  lost attachment acknowledgement, bounded propagation failure, original identity refusal,
  expiry without task-death inference and continued cleanup with new creation disabled.
- Two injected `StepInterruptedError` scenarios verify the interrupted branches and inspect
  the at-most-once/no-retry options. They simulate the SDK interruption result; they are not
  an abrupt managed Lambda termination test. The expiry case uses a controlled local clock.
- The actual compiled/bundled component refuses default-off execution without owner effects.
  Its dependency graph permits durable/DNS control but excludes SQL, ECS/EC2, document objects,
  renderers and private owner implementations.

Logs: `.tmp/d3-resume-route-lifecycle-{documents,build,tests,smoke}.log`. No full frozen-source
verifier, publication, deployment, provider/client acceptance or fresh dependency-audit pass.
The previously recorded five dependency advisory findings remain open.

## Next integration

Supply private current-owner capture/admission, original ready reference attachment and trusted
retirement ports; poll original readiness before capture. Wire this component into the one
stored preparation execution without replacing an accepted original execution on retries.
The current native-resume preparation Terraform has `ExecutionTimeout = 900`; release wiring
must extend it to cover the full 1,800-second route lifetime plus bounded propagation/cleanup.
Retain encrypted checkpoints and original versions for unresolved work and provide terminal
reconciliation/alert handling before activation. No new SQL migration is needed for this
component's checkpointed intent, but managed checkpoint/recovery behavior still needs evidence.

The hostname/zone owner choice, TLS/ingress, exact DNS IAM/network configuration, managed download
flow and accountable acceptance remain. D1 and D3 are incomplete. No frontend/CI/CD changes,
Docker or WSL startup, cloud mutation or PC shutdown.
