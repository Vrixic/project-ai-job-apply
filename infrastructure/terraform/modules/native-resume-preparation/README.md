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
failures target it. This module does not create that queue or its resource/key policies. Before
activation, verify retention, restricted replay access, failure alarms, the rule-scoped
`events.amazonaws.com` SQS SendMessage grant, and customer-key Decrypt/GenerateDataKey permissions
for EventBridge and the observer. Queue encryption must use the supplied platform key. No
scheduled reconciliation is included: a missed source event or an observation delayed beyond ECS
history can leave work unresolved and never proves retirement. Retain original resources until
trusted drain completes.

`enabled`, `new_launch_enabled`, `schedule_enabled` and `observation_events_enabled` all default false. Runtime enablement can
leave launches and scheduling off. Scheduling requires both runtime and launch gates. Published
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
