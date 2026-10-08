# Native application preparation release

Source-only release composition for the existing native cover-letter preparation activity,
durable workflow, SQS starter, terminal handler and scheduled reconciler. A null release creates
no resources. All runtime, launch, intake, drain and recovery gates default off. Development and staging expose optional release maps, empty by default.
This module is not a deployed or activation-ready candidate journey.

The path is owning Applications outbox Ã¢â€ â€™ existing dedicated SQS queue Ã¢â€ â€™ numeric starter Ã¢â€ â€™
original named numeric durable workflow Ã¢â€ â€™ numeric private activity Ã¢â€ â€™ original native launcher.
Terminal events and the periodic reconciler independently verify original execution metadata
before owning SQL settlement. Only the reconciler can send a nudge; neither recovery role can
invoke a workflow or launch a task. Recovery can stay enabled with intake/runtime disabled. Set `drain_enabled` with recovery
to keep SQS consumption and nudges enabled for already bound retained numeric versions only.
`APPLICATION_PREPARATION_INTAKE_ENABLED` defaults false in both starter and reconciler; only
the configured intake owner can bind or nudge unbound work. SQL filters original versions
before leasing, so retained releases cannot steal one another's recovery leases.
Existing executions retain their original numeric activity/configuration; disabling a new
version does not disable an old one. Retain original releases, roles, queues and keys until drain.

Four immutable artifacts are required: `native-application-preparation-lambda`,
`application-preparation-durable-lambda`, `application-preparation-starter-lambda`, and
`application-preparation-recovery-lambda`. The last supplies two separate handlers/roles.
Keys are source/hash-bound beneath `lambda/applications/native-preparation/`; version IDs and
code hashes are mandatory. The guarded publisher selects this family with `-ArtifactFamily NativePreparation`. Its
`build:lambda:native-preparation-family` command compiles once, runs all four original builders
and copies their sixteen release companions into Workflow `dist/native-preparation-family`.
Standalone output paths are preserved. Do not substitute another receipt or fabricate an S3
version to satisfy these inputs. Source builds and receipts do not authorize publication.

Bootstrap `native_preparation_releases` creates the exact
`ai-job-apply-${environment}-prep-runtime-${release_id}-boundary` ceiling, authorizes bounded
role creation and the original durable CloudFormation stack. Each permission is conditioned on
its original actor role, so sharing the release ceiling does not share actor capabilities.
This module cannot create or broaden that boundary. Bootstrap must be applied separately first;
retain each release and its roles until verified drain. Packet encryption and HMAC keys must be distinct from
the platform key. Development/staging can provision the retained pair separately with
`restricted_packet_keys_provisioned=true`. This creates no preparation runtime or trigger.
Use `restricted_packet_key_bindings` to populate exact bootstrap/release inputs only after
reviewing the provisioning result. The symmetric envelope key rotates automatically; the
`HMAC_256` fingerprint key does not support automatic rotation. Both have thirty-day deletion
windows and Terraform destruction protection. Key policy delegates to account IAM and denies
non-packet encryption purposes or non-SHA256 MAC algorithms. Existing exact runtime IAM and
endpoint policies remain required; key creation alone does not grant actor access. Keep these
keys through packet retention and original-release drain. Do not replace the HMAC key or change
a release's key ARN without an explicit retained-data migration design. Existing database secret, Parameters
and Secrets extension, private SQL/Lambda/SQS/Secrets/KMS reachability and log group are inputs
or prerequisites. No provider secret, S3 content, ECS or PassRole grant reaches these roles.
The original launcher, owner RPC, native cover-letter task/image, provider access and DNS/TLS
route composition are separate prerequisites, not supplied by an activity ARN alone.

The caller owns the dedicated same-account standard input queue and distinct recovery DLQ.
Both must use `queue_kms_key_arn`. Require TLS-only queue policies, at least 360-second input
visibility, bounded redrive to a retained DLQ, fourteen-day recovery retention, and exact
producer/EventBridge/role grants in both queue and key policies. Add monitored queue depth,
oldest-message, function error/throttle, EventBridge failed-delivery and Lambda destination
failure alarms before activation. The platform now supplies encrypted retained queues, these policies, private service endpoints
and nineteen alarms per original release. Outbox and execution claims are scoped to retained original numeric versions before leasing. The scheduled recovery envelope is delivered
unchanged; its strict handler binds the rule ARN. Terminal delivery uses the original durable
function prefix and revalidates against at most twenty retained numeric versions. EventBridge
retries terminal delivery for 24 hours; Lambda asynchronous retries are separately capped at
six hours. Scheduled failures do not accumulate retries beyond the next one-minute pass.

Applications/Documents/Profile migrations, restricted-packet protection and accepted synthetic
release/recovery evidence precede activation. ADR-040 stays Proposed and real-data/provider/
client/ATS/accountable acceptance is unchanged. The mocked Terraform suite proves configuration
and permission structure only; it does not prove effective AWS IAM or remote execution.

Local validation uses the repository's pinned Terraform 1.16.2: initialize with `-backend=false`
and `-lockfile=readonly`, then `terraform validate` and `terraform test`. No cloud calls are
needed by the mock suite. Before activation, verify retained original-runtime drain and
packet-key policies. The KMS endpoint enables private DNS and admits preparation packet
operations plus exact existing vault/export/deletion-locator owners when configured. Existing
owners receive no packet-key access. Include any newly composed packet owner explicitly before
activation. Managed launch,
owner/task/route composition and acceptance remain.


Optional `route` pins the hosted zone and base host to the original numeric material control.
Supply the same route to bootstrap and the material-control release; retain it unchanged until
original work drains. Routing gives only the durable actor a separate
`prep-durable-${release_id}-boundary`. Its policy allows the original numeric control, original
activity, durable checkpoints and A-record CREATE/DELETE for UUIDv7 allocation names within that
zone. No UPSERT, owner database, packet keys or task launch is granted. Other actors retain their
existing shared boundary. Bootstrap must create the separate ceiling before workload role updates.

`route_enabled` switches both activity and workflow to stage/propagate/attach.
`route_creation_enabled` independently controls creation; configured routing requires it before
new intake. Leave routing and its permissions available for cleanup when creation is disabled.
Configured routing uses a 3600-second durable execution window for preparation and 30-minute
material expiry/cleanup; legacy unconfigured releases retain 900 seconds. Versioned Lambda
configuration is immutable: changes publish new versions, so retain original numeric functions,
roles and route bindings for existing work. These flags do not remotely disable retained versions.
Both environment maps forward these fields and still default empty/all-disabled.

When publishing a changed activity, include the numeric activities referenced by retained
workflows in `retained_activity_versions` (up to nineteen, in addition to current). The durable
role's identity policy grants that exact set; keeping only `retained_versions` would retain a
workflow without permission to invoke its earlier activity. Do not repoint an original release's
control ARN/route binding while any retained execution still uses it.
