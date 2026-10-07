# Native material control release

Composes the existing private native launcher, owner RPC and task-event handler as three
numeric Lambda versions with separate roles. Development/staging expose empty-by-default
`native_material_control_releases`; null creates no resources and all four switches default off.
New launch requires owner, control and recovery switches. Recovery can remain enabled with
new launch disabled. Existing numeric versions retain their original environment and authority.

The launcher and owner use private SQL through the pinned database secret and Parameters and
Secrets extension. Only the launcher may RunTask on the exact original definition/cluster and
PassRole the two original task roles; it cannot stop tasks or invoke another Lambda. DescribeTaskDefinition
uses its required wildcard, followed by the runtime's strict original-definition validation.
The owner cannot invoke functions or control ECS. The event handler has neither VPC nor database
secret; its only control capability is invoking the numeric original launcher, and its existing
runtime emits recover requests only. All three deny object-store access. No provider secret is
provided to a control Lambda.

The original image, task revision, roles, CPU/memory, container name and task network are
encoded into the launch configuration. Owner identity uses that same task role/deployment.
Source/hash/version-bound artifacts use `lambda/documents/native-material/control/`; the guarded publisher selects the three-artifact/twelve-object family with
`-ArtifactFamily NativeMaterialControls`. The family builder preserves standalone artifact
paths and stages companions under Workflow `dist/native-material-control-family`. Keys use
`<source>/<artifact-sha>/<artifact-name>.zip`, matching the immutable receipt contract.
Source qualification, audit, repeated build and object-version/readback gates remain in force.

This source composition is not activation-ready. Bootstrap `native_material_control_releases` creates and authorizes the exact
`ai-job-apply-${environment}-material-launch-${release_id}-boundary`; this module cannot broaden
that ceiling. Existing workload boundaries cover owner/event but effective IAM still needs
managed verification. Platform composition supplies exact database-secret access to launcher/owner,
pinned provider/TLS reads and numeric owner RPC to tasks, and original ECS launch/observation to
the launcher through shared private endpoints. Declared control and preparation groups reach SQL;
material task groups must remain separate from every SQL-authorized group. Secret/key policies
and actual network reachability still require managed verification. The original task-change rule invokes the numeric
event-handler version only when recovery is enabled. EventBridge delivery and Lambda asynchronous
execution have separate retry budgets and share the original encrypted fourteen-day failure queue
provided by the platform, with delivery, destination, queue and function alarms. No function URL
is created here. The image, provider
egress, task read route and controlled image/release publication remain separate prerequisites.

Seven mocked Terraform scenarios cover absence, original role/environment restrictions, recovery
without new launches, activation prerequisites, foreign bindings and null-release refusal.
Both environments validate, and the generated launch configuration passes the actual compiled
runtime validator. These checks do not prove live AWS permissions or execution. Retain original
versions, roles, task definitions and secrets until verified drain; disabling new launch does
not authorize deleting them.


`task_public_ip_enabled` defaults false. An explicitly reviewed direct-TLS release can set it
true without enabling launch/recovery or creating DNS/ingress. Its subnets must have the reviewed
public route and its task groups must remain separate from SQL groups. This is immutable launch
configuration: retain the original configuration for recovery rather than changing it for an
already claimed generation. Address discovery, route ownership, EC2 endpoint/IAM grants and DNS
lifecycle composition remain separate from this switch.
