# Development serverless cutover source evidence

Date: 2026-08-07
Delivery: D0-016 / SR-005 / SR-007
Environment: isolated development in `us-east-2`
Status: Source-only cutover boundary implemented and locally verified; no AWS plan or mutation

## Implemented boundary

The proven staging cutover operator is now environment-aware while preserving staging as its
compatibility default. Development receives narrow wrappers for:

- initial atomic cutover planning and completed-runtime verification;
- checksum-only saved-plan apply;
- ordered route/dispatch/trigger rollback with the Lambda integration retained;
- separately reviewed unreferenced-integration cleanup;
- restoration and source-lineage-safe context continuation; and
- aggregate serverless workload/cost inspection after acceptance.

Every environment-dependent path is derived from the exact `development` or `staging` selector:
Terraform root, default short-lived IAM Identity Center profile, Temporal secret, queues/DLQs,
durable function, application log group, API, RDS instance, alarms, ECS cluster, output environment,
and ignored rollback-context schema. The development wrappers bind `development` and do not accept
a caller-selected environment.

## Change boundary

The initial development plan must contain exactly three creates and six in-place updates: the
Lambda API integration, two public health routes, the protected default route, gateway
function/alias, SQS starter mapping, reconciler rule, and terminal rule. It must contain zero
deletes, replacements, ECS-capacity changes, persistent-data changes, secret changes, or rollback
resource deletion. All three workflow triggers enable together and new-event dispatch changes once
from `temporal` to `lambda_durable`.

Apply remains separately checksum-authorized and uses only the reviewed saved plan. It requires
clean upstream-matched `main`, Terraform 1.9.8, the exact development account/state boundary,
short-lived assumed-role credentials, idle retained ECS, zero pending outbox rows, zero open
Temporal/durable executions, empty queues/DLQs, exact immutable artifacts, and immediate
refresh-backed zero drift.

Rollback retains the staging-proven two-step order: first move routes/dispatch/triggers while
retaining the integration, verify zero drift, then separately authorize deleting only the
unreferenced integration. Restoration is also separately planned and authorized. No path resumes
ECS or deletes Lambda, ECS, Cloud Map, API, queue, database, or Temporal rollback resources.

## Local verification

- all changed PowerShell files parse;
- development planner/operator help contracts execute without AWS access;
- infrastructure policy validation requires exact environment isolation, development wrappers,
  dynamic queue/secret/context boundaries, and ordered rollback semantics;
- the environment-aware workload inspector retains structured-severity privacy checks, six-Lambda
  metrics, both DLQs, ten alarms, idle ECS, and zero-drift verification; and
- repository verification and Markdown-link checks are required before publication.

No plan, context, AWS resource, application record, queue message, workflow, or traffic route was
created or changed. The local development IAM Identity Center session is expired; after this source
merges, refresh that short-lived session and generate the first exact-main read-only cutover plan.
The resulting plan checksum is the next explicit authorization gate.

