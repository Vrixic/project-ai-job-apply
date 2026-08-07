# Development serverless cutover source evidence

Date: 2026-08-07
Delivery: D0-016 / SR-005 / SR-007
Environment: isolated development in `us-east-2`
Status: Exact dark KMS prerequisite applied and zero drift verified; cutover planning now awaits a merged plan-time route-reference validator correction

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

After that correction merged, the product owner explicitly authorized checksum
`2d236550ab4ab7744238b80f2a919871b53fde9b0e2f6273175610db43aff324`. Terraform applied only the
gateway and reconciler inline-policy updates. Independent refresh-backed verification returned zero
drift with Temporal dispatch, all replacement triggers disabled, and retained ECS idle. No route,
traffic, trigger, capacity, application record, queue message, workflow, secret, or persistent-data
resource changed.

The following cutover plan reached its intended three-create/six-update shape, JWT scopes, and dark
preconditions but failed closed before returning an authorization checksum. Both the new Lambda
integration ID and its default-route target are legitimately plan-time unknown; the semantic guard
incorrectly compared their absent concrete JSON values. The local correction keeps exact equality
for known live targets and, for this create-time case only, requires both values to be unknown and
the route expression to reference the exact platform Lambda integration. PowerShell parsing,
infrastructure policy validation, skill validation, and formatting checks pass. The rejected plan
is ignored and unauthorized; no additional AWS mutation occurred.

After the correction merged, exact-main planning and independent operator review returned three
creates, six updates, zero deletes/replacements, and checksum
`482cdeafc1d012c964a756420a5c0405955f2fc743b3b0e3e096a10449fb6e87`. The product owner explicitly
authorized that checksum. Terraform completed all nine actions: the Lambda proxy integration and
two public health routes were created; the protected route, gateway function/alias, SQS starter,
reconciler, and terminal rule were updated; nothing was destroyed.

The built-in post-apply verifier then stopped on a local strict-property exception before returning
its zero-drift summary. It correctly reached the now-materialized route, whose empty
`after_unknown` object omits `target`; the validator accessed that absent property directly. The
apply was not retried. Independent read-only AWS inspection proves the gateway is active, dispatch
is `lambda_durable`, all three triggers are enabled, the default route is JWT-protected with exact
`profile:read`/`profile:write` scopes, only the two health routes are anonymous, public behavior is
`200/200/401`, and both retained ECS services are `0/0/0`. Source now treats omitted unknown flags
as false while retaining the exact known-target equality check. Fresh exact-main zero-drift
verification remains required after merge.
