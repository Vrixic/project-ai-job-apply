# Native resume preparation release

Release module for private control, durable workflow, Applications outbox dispatch and stopped-task observation. Development and staging expose optional release maps, empty by default. `release = null` creates nothing.
An exact release creates the four functions with separate bounded roles and disabled event rules.
No candidate content or secret values enter Terraform.

The control function pins the original task definition, image and revision-qualified roles. It
can describe task metadata, run that exact definition in its original cluster, pass only its two
roles to ECS, and recover positively identified tasks. Application admission still owns the
single persisted launch attempt. Task networking preserves the explicit `task_assign_public_ip` release choice (`ENABLED` or
`DISABLED`) with the reviewed subnets/security groups. A public address alone does not supply
DNS, a trusted certificate, a public-subnet route or inbound rules. Private-only tasks need an
independently reviewed browser-accessible routing path. No network mode is inferred. Control has owning database access but no S3, remote-exec or stop authority.

The durable function pins the numeric control version and has encrypted scalar checkpoints,
seven-day history retention and a 900-second execution timeout. It has no database secret or VPC
configuration and explicitly denies database/secret/task capabilities. Terraform owns its
CloudFormation stack using the existing platform pattern for `DurableConfig.KMSKeyArn`.
The retained numeric version incorporates the environment hash, including control recipient and
runtime gate, so configuration changes publish a coherent replacement.

Dispatcher pins the resulting numeric workflow version and original deployment identifiers.
It uses the existing bounded SQL outbox/lease/recovery implementation, not a second queue. The
one-minute schedule passes only `{schemaVersion: 1, action: "sweep"}` to its numeric version.
Missed schedule delivery is retried by the next sweep; EventBridge retries are disabled. SQL
claim limits and exhaustion remain application-owned. Timeout/failure is not evidence of task
retirement and does not authorize a replacement generation.

The observer rule selects STOPPED events for the original cluster/task definition and invokes
an exact numeric observer version. Observation can remain enabled while new launches are off.
Its role can describe original-cluster tasks and access the owning database, but cannot launch,
stop, pass roles or invoke other functions. Event data is only a hint; fresh ECS observation
and the original SQL allocation determine retirement.

`observer_dead_letter_arn` must identify an existing same-account standard SQS queue. Both
EventBridge delivery failures (24-hour/185-attempt retry window) and Lambda asynchronous execution
failures target it. This module consumes the queue. Development/staging composition now provisions it through the
platform module with fourteen-day platform-key encryption, TLS enforcement, original-rule
SendMessage/key grants and alerts for visible messages and both failed-DLQ delivery paths.
Queue deletion is protected; retain each original release entry until reviewed drain. Preparation
waits for platform dependencies. Standalone callers must provide equivalent infrastructure.
Before activation, verify effective permissions, alarm delivery and restricted replay access.
The separately gated sweep below recovers missed events for bound tasks. Observation delayed beyond
ECS history can still leave work unresolved and never proves retirement. Retain original resources
until trusted drain completes.

`enabled`, `new_launch_enabled`, `schedule_enabled`, `observation_events_enabled` and
`observation_schedule_enabled` all default false. Runtime enablement can
leave launches and scheduling off. Launch scheduling requires both runtime and launch gates;
observation scheduling requires only the runtime gate. Published
Lambda environments are immutable: flipping a gate publishes new versions and does not disable
old numeric recipients. Disable the event rule to stop scheduled intake, retain original release
instances/roles and resolve existing work through the reviewed drain process. Removing this
module is not a safe retirement mechanism. Keep the original input/artifact set immutable while
its work is unresolved; permission retargeting can break retained versions.

Inputs require the four immutable artifact receipts, original image/task, existing secret/key,
extension and distinct task/Lambda network identifiers. Required external dependencies include
private database/ECS/Lambda/Secrets Manager reachability, image pull and task TLS/read routing,
resource/key policies, migrations and release acceptance. Control and observer require separate original-release boundaries supplied by bootstrap
`native_resume_control_releases`; durable and dispatch retain the shared workload boundary. The optional
bootstrap input also supplies exact role-creation and durable-stack deployment permissions.
Those source changes require separate review/application before managed release.
This module alone cannot activate a working cloud path.

Local Terraform 1.16.2 validation and ten mocked tests cover absence, connected numeric versions,
CMK state, capability separation, disabled defaults and invalid activation/target cases. The
emitted launch JSON also passes the actual compiled Documents launch configuration validator;
dispatch deployment fields agree. Cloud resources and numeric outputs are synthetic in these
checks. Enabled main, managed IAM/routing and client/ATS acceptance remain unverified.

```powershell
terraform -chdir=infrastructure/terraform/modules/native-resume-preparation init -backend=false -lockfile=readonly
terraform -chdir=infrastructure/terraform/modules/native-resume-preparation validate
terraform -chdir=infrastructure/terraform/modules/native-resume-preparation test
```

AWS references: [ECS action scopes](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ecs.html)
(`DescribeTaskDefinition` requires a wildcard resource) and
[durable configuration](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-function-durableconfig.html).
These sources do not establish effective permissions or deployment evidence for this release.

Failure recovery: inspect messages only through an authorized operations session; do not paste raw
events into logs, tickets or source. Identify the original revision, resolve its delivery failure,
and replay the original event to that revision's numeric observer. The observer still obtains
fresh ECS evidence; a queue message cannot substitute for a terminal receipt. Remove a message
only after successful handling or an accountable resolution. Investigate before the fourteen-day
retention expires; expiration does not resolve the SQL allocation. There is no automatic redrive
consumer or new operator permission grant in this change.


## Scheduled recovery of missed task events

After Documents migration `0015_native_resume_observation` and publication of the matching observer,
`observation_schedule_enabled` independently enables a one-minute scalar `sweep` invocation at the
original numeric observer version. It defaults false and requires `enabled`; new launches can stay
disabled. The observer now has a 60-second timeout. Each invocation selects at most two bound
allocations for its exact launch configuration, rotating oldest attempts with a 60-second retry
delay. Selection commits before remote observation; crashes leave tasks eligible again later.
The existing trusted observer still requires fresh exact ECS STOPPED evidence before retirement.
Running, missing and failed ECS observations stay unresolved. No RunTask, StopTask or new IAM
capability is added. A pending lost-launch-ACK row without a bound task remains outside this sweep.

Scheduled event delivery has no retries: the next minute selects work again. Its FailedInvocations
alarm uses the existing operational topic; Lambda execution failures retain the existing DLQ.
Stopped-task event delivery remains the primary path. Monitor backlog and review batch/schedule
capacity before increasing traffic; two attempts/minute is this bounded fallback's nominal capacity.
Retain the original observer/configuration until its bound rows drain. Disable the schedule to
stop new sweeps; disabling new launches does not stop cleanup observation. This is source/local
verification, not a deployed migration, active schedule or verified live ECS observation.


Stopped-task events also recover an original persisted launch claim whose RunTask response or
binding acknowledgement was lost. The event supplies only a hint: recovery describes that exact
task and validates its original allocation, task definition, launch mode and six scalar overrides
before binding it. A separate fresh terminal observation then records retirement. Recovery uses
no claim-creation port and hard-disables new launches; IAM still denies RunTask and StopTask.
Unclaimed, mismatched or unavailable task metadata stays unresolved. A scalar manual observe or
scheduled sweep cannot invent the missing task ARN. Retired replays use the original SQL receipt.

## Original resume download route

Optional `route = { hosted_zone_id, base_host }` must agree between the preparation release and
bootstrap `native_resume_control_releases` for the original revision. Bootstrap supplies a
principal-bound durable DNS ceiling; the preparation module grants exact-zone CREATE/DELETE A
records under the original host plus zone inspection/change status. The shared boundary gains
no DNS capability. Route runtime and creation switches default false and are independent of
new task launches. Keep lifecycle enabled for original cleanup when creation stops. The durable
execution budget is 2,400 seconds; encrypted checkpoint retention remains seven days.

Prepare bootstrap first and use a new original release; retain old roles/versions/configuration
until drain. This does not migrate an existing role boundary or enable retained numeric versions.
Network reachability, matching TLS/ingress, terminal reconciliation and live download acceptance
remain required. Local mocked Terraform checks are not effective managed IAM evidence.

## Terminal route failures

Routed workflows checkpoint their scalar outcome and fail when cleanup remains unresolved or
attachment is unacknowledged. `terminal_events_enabled` defaults false and can stay enabled while
runtime/intake is off. It retains scalar failed/stopped/timed-out notices for all numeric versions
of the original durable function in the existing encrypted observation queue. Platform composition
supplies exact-rule queue/KMS grants and delivery/execution alarms. Follow the
[original recovery runbook](../../../runbooks/observability/native-resume-terminal-recovery.md).
No automatic redrive or replacement execution is provided. Managed alert/recovery drills and
missed-event reconciliation remain required; retained checkpoints expire after seven days.
