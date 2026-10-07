# Native application preparation release

Source-only release composition for the existing native cover-letter preparation activity,
durable workflow, SQS starter, terminal handler and scheduled reconciler. A null release creates
no resources. All runtime, launch, intake and recovery gates default off. No environment calls
this module yet; this module is not a deployed or activation-ready candidate journey.

The path is owning Applications outbox → existing dedicated SQS queue → numeric starter →
original named numeric durable workflow → numeric private activity → original native launcher.
Terminal events and the periodic reconciler independently verify original execution metadata
before owning SQL settlement. Only the reconciler can send a nudge; neither recovery role can
invoke a workflow or launch a task. Recovery can stay enabled with intake/runtime disabled.
Existing executions retain their original numeric activity/configuration; disabling a new
version does not disable an old one. Retain original releases, roles, queues and keys until drain.

Four immutable artifacts are required: `native-application-preparation-lambda`,
`application-preparation-durable-lambda`, `application-preparation-starter-lambda`, and
`application-preparation-recovery-lambda`. The last supplies two separate handlers/roles.
Keys are source/hash-bound beneath `lambda/applications/native-preparation/`; version IDs and
code hashes are mandatory. The guarded publisher does not yet support this family. Do not
substitute another artifact receipt or fabricate an S3 version to satisfy these inputs.

Bootstrap must separately create the exact `${function_name}-boundary` permissions ceilings
and authorize their role creation and the durable CloudFormation stack. This module cannot
create or broaden those boundaries. Packet encryption and HMAC keys must be distinct from
the platform key, with separately reviewed key policies. Existing database secret, Parameters
and Secrets extension, private SQL/Lambda/SQS/Secrets/KMS reachability and log group are inputs
or prerequisites. No provider secret, S3 content, ECS or PassRole grant reaches these roles.
The original launcher, owner RPC, native cover-letter task/image, provider access and DNS/TLS
route composition are separate prerequisites, not supplied by an activity ARN alone.

The caller owns the dedicated same-account standard input queue and distinct recovery DLQ.
Both must use `queue_kms_key_arn`. Require TLS-only queue policies, at least 360-second input
visibility, bounded redrive to a retained DLQ, fourteen-day recovery retention, and exact
producer/EventBridge/role grants in both queue and key policies. Add monitored queue depth,
oldest-message, function error/throttle, EventBridge failed-delivery and Lambda destination
failure alarms before activation. Queue creation, outbox routing and those policies/alarms
are not yet integrated into the platform. The scheduled recovery envelope is delivered
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
needed by the mock suite. Environment, bootstrap, publisher and network/queue integration remain
the next connected source work before managed planning.
