# D0 Staging Application Recovery Evidence — 2026-07-31

## Scope

This record covers the controlled workflow-worker and gateway rolling restarts, exact
application-only disablement, exact reverse re-enablement, and post-recovery authenticated and
operational acceptance in the dedicated synthetic-only staging AWS environment in `us-east-2`.

It proves the application runtime can restart and be removed/recreated without changing the
persistent platform or migration history. It does not prove PostgreSQL restore, representative
workload or cost baselines, independent Auth0 tenant isolation, production high availability, or
accountable legal/privacy or security/privacy approval.

Under [ADR-014](../../../adr/014-shared-development-auth0-for-synthetic-staging.md), the test used
only synthetic identity and product data. No real candidate data or live ATS action was permitted.

## Authorization and preconditions

- [PR #47](https://github.com/Vrixic/project-ai-job-apply/pull/47) merged the reviewed
  [recovery operator](d0-provider-runtime-repository-cleanup-2026-08-08.md),
  [runbook](d0-provider-runtime-repository-cleanup-2026-08-08.md), and
  [preflight evidence](d0-staging-application-recovery-preflight-2026-07-31.md) as
  `fd1193c22b0c40b1974a4efdec83f6f1d7b4d553`.
- The merged Terraform source was unchanged from the source that produced the saved disable plan.
- The temporary staging IAM Identity Center caller and Terraform `1.9.8` were used against the
  existing isolated encrypted staging state.
- The saved disable artifact still matched reviewed SHA-256
  `0F7A9ABB1FDACB1EAAB83A48475DE8FDAC40C842FB71D2C3618B85AADB5FB8F9`.
- Both services started `ACTIVE` at desired/running/pending `1/1/0`, with one completed primary
  deployment and the reviewed `100%` minimum / `200%` maximum rolling policy.
- Gateway live/readiness/protected responses were `200/200/401`.

No account, ARN, task, endpoint, image, provider, identity, preference, operation, trace, token,
secret, raw log message, plan contents, or notification destination is retained here.

## Controlled rolling restart

The operator restarted the workflow worker first and the gateway second. For both services:

- exactly one running task was replaced;
- the immutable task definition remained unchanged;
- gateway liveness remained `200` at every observed deployment poll;
- the final service state returned to `1/1/0` with one completed primary deployment; and
- no task failed.

Final live/readiness/protected responses remained `200/200/401`, and an identical-input
refresh-backed Terraform plan reported no drift. The strict procedure took about eight minutes
because it waited for ECS to remove each prior deployment record rather than accepting only equal
desired/running counts.

## Exact application-only disablement

Immediately before apply, the operator re-inspected the saved plan and required both the supplied
and locally recorded checksum. Applying that exact artifact produced:

- 16 deletes: five API Gateway resources, two Cloud Map resources, gateway/worker task definitions
  and services, one bounded tracing policy, two heartbeat metric filters, and two heartbeat alarms;
- one in-place operations-dashboard update;
- zero creates and zero replacements; and
- no other resource action.

The disabled-state acceptance found zero ECS services, running tasks, platform APIs, and Cloud Map
namespaces. An identical-input applications-disabled Terraform plan reported no drift.

RDS, KMS, S3, SQS/DLQ, ECR, Secrets Manager containers and values, networking, encrypted remote
state, the migration task definition, and migration/data history remained outside the plan and
unchanged.

## Exact reverse re-enablement

From the verified disabled posture, the operator reconstructed the original application inputs
from the ignored local recovery context. Semantic review accepted SHA-256
`0B025C8FFC6D60C62444947CBC403FA9142FA860A28DE7613F4207336091B0BD` with exactly:

- 16 application creates;
- one operations-dashboard update;
- zero deletes and zero replacements; and
- no action outside the same application boundary.

The exact saved artifact applied successfully. The first post-apply acceptance stopped because
the gateway was already serving at `1/1/0` and `200/200/401`, but ECS still labeled its single
primary deployment `IN_PROGRESS`. No second plan or apply was attempted. A bounded read-only poll
continued to require liveness `200` until ECS reported `COMPLETED`; the worker was already
complete, and both services had zero failed tasks.

Final strict status then passed with two stable services and live/readiness/protected responses
`200/200/401`.

## Authenticated and operational recovery

After re-enablement, the product owner used the local server-held conformance client against the
deployed staging gateway. A synthetic authenticated preference save reached the displayed
`Operation Succeeded` state. Correlated encrypted logs independently found one successful
preference write and one successful durable-operation read.

The application-only cycle recreated both heartbeat alarms. CloudWatch recorded zero `ALARM` and
two `OK` transitions during the controlled interval. The product owner provided visual
confirmation of both matching gateway and worker `OK` notifications at the re-enablement time.
No second notifications were expected after the later local-PC restart because that restart did
not change AWS alarms or services.

Final aggregate inspection established:

- all eight managed staging alarms were `OK`;
- 249 recent encrypted application events included 121 privacy-safe heartbeats;
- error-level events: zero;
- forbidden credential/candidate/email/JWT pattern matches: zero;
- 94 recent X-Ray trace summaries contained one complete gateway → outbox → Temporal activity
  workflow trace; and
- forbidden trace-document matches: zero.

The complete trace contained the gateway, `outbox.dispatch`,
`profile-readiness.mark-running`, and `profile-readiness.calculate-and-persist` spans. This
corroborates the displayed durable result without retaining its identifier or content.

## Drift and cleanup

The final cleanup first required stable enabled services and an identical-input refresh-backed
Terraform no-drift result. It then removed exactly the local disable plan, enable plan, and
recovery context from the staging Terraform data directory. The local conformance web process was
stopped, and its generated `next-env.d.ts` development-path change was restored without retaining
an incidental repository diff.

This closes the staging service-restart and application-only rollback/reenablement gate for
D0-006 and D0-011. Staging PostgreSQL restore plus representative workload and cost-attribution
evidence remain open. The dedicated Auth0 tenant cutover/replay remains a D6 launch gate.
