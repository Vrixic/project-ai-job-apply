# Development serverless cutover source evidence

Date: 2026-08-07
Delivery: D0-016 / SR-005 / SR-007
Environment: isolated development in `us-east-2`
Status: Exact two-update plan generated; independent operator review failed closed on a corrected guard; no plan authorized or applied

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

After merge and SSO refresh, the first exact-main plan failed closed before returning a checksum.
Its sanitized action inventory contained the intended three creates/six updates plus exactly two
additional in-place IAM policy updates. Both add only `kms:GenerateDataKey` to the gateway and
reconciler producer roles; there were zero deletes or replacements. This is the same encrypted-SQS
producer prerequisite previously discovered and accepted in staging, not cutover drift.

No plan was authorized or applied, and no persistent AWS resource, application record, queue
message, workflow, or traffic route changed. The first separate prerequisite attempt also failed
closed before Terraform planning because it reused the post-cutover KMS mode, which correctly
required enabled triggers while development remains dark. That exposed a boundary-selection defect,
not live drift.

The distinct pre-cutover mode then reached an older gateway-only baseline path. That helper
correctly rejected the fully deployed workflow resources because a gateway-only plan would propose
deleting them. No prerequisite plan or checksum was produced. The mode now reconstructs its
baseline from the complete tracked remote state, matching every other completed-workflow and
cutover mode, while retaining the exact artifact, live-resource, trigger, dispatch, action, and
zero-drift checks.

The corrected source permits only the same two IAM policy updates while requiring
`serverless_runtime_cutover = false`, Temporal dispatch, disabled SQS/EventBridge triggers, idle
ECS, and zero unrelated changes. The operator binds the saved plan to that dark boundary and runs
matching dark zero-drift verification immediately after apply. Merge, regenerate the exact
two-policy plan, and request explicit authorization for its checksum before retrying the cutover
plan.

After the full-state correction merged, planning produced exactly those two updates with zero
creates, deletes, replacements, traffic, trigger, or ECS-capacity changes. Independent operator
review then failed closed because its generic component loop still required runtime cutover before
the following boundary-specific check could accept the dark state. The saved plan was not
authorized or applied. Source now leaves runtime/dark selection exclusively to the exact boundary
check and restores the completed-runtime requirement accidentally omitted from the workflow-release
guard; function-scoped policy validation protects both conditions.
