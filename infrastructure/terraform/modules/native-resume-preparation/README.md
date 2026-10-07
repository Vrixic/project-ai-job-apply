# Native resume preparation release

Unattached release module for the existing private control, durable workflow and Applications
outbox dispatcher. Neither environment instantiates it. `release = null` creates nothing.
An exact release creates the three functions with separate bounded roles and a disabled schedule.
No candidate content or secret values enter Terraform.

The control function pins the original task definition, image and revision-qualified roles. It
can describe task metadata, run that exact definition in its original cluster, pass only its two
roles to ECS, and recover positively identified tasks. Application admission still owns the
single persisted launch attempt. Task networking uses the reviewed subnets/security groups with
public IP disabled. Control has owning database access but no S3, remote-exec or stop authority.

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

`enabled`, `new_launch_enabled` and `schedule_enabled` all default false. Runtime enablement can
leave launches and scheduling off. Scheduling requires both runtime and launch gates. Published
Lambda environments are immutable: flipping a gate publishes new versions and does not disable
old numeric recipients. Disable the event rule to stop scheduled intake, retain original release
instances/roles and resolve existing work through the reviewed drain process. Removing this
module is not a safe retirement mechanism. Keep the original input/artifact set immutable while
its work is unresolved; permission retargeting can break retained versions.

Inputs require the three immutable artifact receipts, original image/task, existing secret/key,
extension and distinct task/Lambda network identifiers. Required external dependencies include
private database/ECS/Lambda/Secrets Manager reachability, image pull and task TLS/read routing,
resource/key policies, migrations and release acceptance. Control requires the dedicated original-release boundary supplied by bootstrap
`native_resume_control_releases`; other actors retain the shared workload boundary. The optional
bootstrap input also supplies exact role-creation and durable-stack deployment permissions.
Those source changes require separate review/application before managed release.
This module alone cannot activate a working cloud path.

Local Terraform 1.16.2 validation and six mocked tests cover absence, connected numeric versions,
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
