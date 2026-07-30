# D0 Development Temporal Secret Rotation Evidence — 2026-07-30

## Scope

This record covers one overlap-safe rotation of the deployed development Temporal Cloud worker API
key stored in KMS-encrypted AWS Secrets Manager. It proves that a new managed value can be
validated, loaded by a replacement ECS worker, used for real workflow completion, and retained as
the only active provider credential before the old key is disabled and deleted.

It does not independently prove the provider-side Service Account mapping, exact expiration date,
or absence of broader-than-required provider permission. It also does not establish production
rotation automation, staging acceptance, or accountable security/privacy approval.

No API-key value or ID, AWS version ID, account/namespace suffix, endpoint, ARN, task, workflow,
operation, event, identity, preference, response payload, or raw log event is retained.

## Pre-rotation baseline

The drill ran from merged `main` commit
`017a77260ae2afe78f312042a2eb2e80a44db4e5`, after the PostgreSQL restore evidence merged in
[PR #29](https://github.com/Vrixic/project-ai-job-apply/pull/29).

Sanitized preflight established:

- the caller used a temporary IAM Identity Center assumed role in the exact development account;
- the managed destination contained exactly one `AWSCURRENT` value and no deprecated version;
- the current value passed secret-safe Temporal namespace read conformance;
- the worker task definition referenced the exact managed secret;
- worker and gateway were stable at the lean one-task baseline; and
- the worker rolling boundary preserved `100%` minimum healthy capacity and allowed `200%`
  maximum capacity.

The operator created the replacement Service Account key through the provider UI and wrote its
one-time plaintext directly into the existing AWS secret. The value did not enter chat, source,
Terraform, a command argument, or evidence. AWS then exposed one new `AWSCURRENT` and one distinct
`AWSPREVIOUS` rollback version. Direct `AWSCURRENT` conformance passed before rollout.

The documented verifier invocation was corrected to call the Node entry point directly. The prior
package-manager wrapper echoed the non-secret Namespace ID and endpoint before the verifier could
apply its output-minimization guarantee; direct invocation emits only sanitized pass/fail lines.

## Worker rollout and functional proof

Only the workflow-worker service received a forced deployment. Its task definition, desired count,
gateway deployment, database, queues, secrets, and persistent infrastructure were unchanged.

Observed rollout state progressed safely:

- the prior worker continued running while the replacement was pending;
- the new worker reached running before the prior task drained;
- the service converged to one desired, one running, and zero pending tasks;
- the primary deployment completed with zero failed tasks; and
- the running task started after creation of the new `AWSCURRENT` version.

The new task's encrypted startup stream contained one expected worker-start event and zero
authentication, connection, or forbidden-secret patterns.

The product owner then made one harmless temporary preference change and restored the original
value in a second save. Both UI operations reached `succeeded`. Sanitized independent
corroboration found:

- two completed post-rotation Temporal readiness workflows;
- two succeeded durable operations and zero incomplete operations;
- two published preference-update events; and
- two readiness-calculated events.

No value or identifier from those transactions was retained.

## Prior-key revocation and final state

After the functional proof, the operator disabled the old provider key. An in-memory probe using
the AWS `AWSPREVIOUS` value initially observed provider propagation, then proved the old value was
rejected. Throughout the observation window, `AWSCURRENT` conformance passed and the worker
remained stable without authentication or connection errors.

The operator then deleted the old provider key. A final in-memory probe proved the deleted value
remained rejected. The `AWSPREVIOUS` staging label was removed from AWS, leaving:

- exactly one staged `AWSCURRENT`;
- zero staged `AWSPREVIOUS`; and
- one unlabeled historical AWS version whose provider credential has been deleted and cannot
  authenticate.

Final acceptance established:

- gateway and workflow worker each had one completed primary deployment at `1/1/0` with zero
  failed tasks;
- both collector sidecars were healthy;
- live/readiness/protected responses remained `200`/`200`/`401`;
- all six managed development alarms reported `OK`;
- 171 rotation-window application log events contained zero error, forbidden candidate/credential,
  email, or JWT pattern matches;
- current Temporal namespace conformance passed; and
- a final refresh-backed Terraform plan reconstructed from exact live inputs reported no drift.

This closes the deployed runtime-secret rotation substep of D0-006/D0-011 and the rotation portion
of SP-09. Provider-side permission/expiry review, Auth0 recovery/provider checks, on-demand
staging, quality/fixture evidence, and accountable approvals remain open.
