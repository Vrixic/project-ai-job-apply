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

The original image, task revision, roles, CPU/memory, container name and private network are
encoded into the launch configuration. Owner identity uses that same task role/deployment.
Source/hash/version-bound artifacts use `lambda/documents/native-material/control/`; a guarded
publisher family for these three artifacts is still required. Do not invent object versions.

This source composition is not activation-ready. Bootstrap must create and authorize the exact
`ai-job-apply-${environment}-material-launch-${release_id}-boundary`; this module cannot broaden
that ceiling. Existing workload boundaries cover owner/event but effective IAM still needs
managed verification. Platform integration must supply original secret/Lambda/ECS endpoint
permissions, EventBridge task-change delivery with retained failure handling and alarms, and
required secret/key policies. No event rule or function URL is created here. The image, provider
egress, task read route and controlled image/release publication remain separate prerequisites.

Six mocked Terraform scenarios cover absence, original role/environment restrictions, recovery
without new launches, activation prerequisites, foreign bindings and null-release refusal.
Both environments validate, and the generated launch configuration passes the actual compiled
runtime validator. These checks do not prove live AWS permissions or execution. Retain original
versions, roles, task definitions and secrets until verified drain; disabling new launch does
not authorize deleting them.
