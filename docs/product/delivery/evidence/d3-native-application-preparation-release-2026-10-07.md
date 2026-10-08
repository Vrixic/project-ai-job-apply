# Native application preparation release composition — 2026-10-07

D3-017/D3-068 through D3-071/D3-079 now have a standalone default-off
[Terraform module](../../../../infrastructure/terraform/modules/native-application-preparation/README.md)
connecting the existing private activity, durable workflow, SQS starter, terminal handler and
scheduled reconciler. This is local source implementation, not environment integration or release.

The activity alone invokes the supplied original numeric launcher and uses distinct packet
encryption/HMAC keys. Durable orchestration invokes only the numeric activity and owns its
checkpoints. The starter consumes one request at a time with partial-batch failure reporting and
invokes retained numeric workflow versions. Separate recovery roles read original execution
metadata and settle through owning SQL; only the scheduled role may nudge the input queue.
Both recovery roles explicitly deny Lambda invocation. New intake requires runtime, launch and
recovery gates; recovery may remain enabled while the other gates are false. Existing immutable
versions and retained original resource ownership must survive until drain.

Four source/hash/version-bound artifacts produce five Lambda functions/roles. No database secret
reaches orchestration, and no runtime role gains S3, ECS or PassRole authority. Private Lambda
networking, pinned extension, existing encrypted queues and distinct packet keys are required.
The module references exact independently supplied bootstrap permissions ceilings. It creates
no bootstrap authority, queue, content process or network endpoint. The README lists the exact
remaining resource-policy, outbox, alarm, publisher, environment and original task prerequisites.

Validation: pinned Terraform 1.16.2 / AWS provider 6.58.0, backend disabled, mocked provider.
`terraform validate` and all seven `terraform test` scenarios pass. Tests cover absent/default-off
resources, numeric targets, strict terminal configuration, deny-invocation recovery, retained
versions, recovery without intake, rejected aliases/missing release, intake gating and enabled
flag composition. The first run caught an invalid 24-hour Lambda asynchronous window; corrected
to six hours while retaining EventBridge's independent 24-hour terminal retry. A mock rule ARN
fixture was also corrected. The final rerun passes after ordering IAM attachment and event
permissions before consumers/targets. Serverless infrastructure policy validation passes.
Ignored log: `.tmp/d3-native-application-preparation-terraform.log`.

No cloud calls, full workspace rerun, live runtime, effective IAM, migration, publication,
activation, frontend/client/ATS or accountable approval is claimed. No runtime TypeScript changed.
Bootstrap, publisher and platform/environment integration are the next connected implementation
steps. D1/D3 stay In progress; ADR-040 stays Proposed, Docker/WSL stay stopped and PC stays on.

## Guarded artifact family

`NativePreparation` is now a separate guarded publisher family matching this module's four
artifact names and `lambda/applications/native-preparation` source/hash key root. Dedicated
receipt/output roots and an exact sixteen-object inventory prevent accidental mixing with
Document, NativeResume or private-control receipts. Case variants select the same family.
Existing merge/source, audit, deterministic build, KMS/versioning and independent readback gates
are retained. No publisher Status/Publish/Verify cloud action was run.

The new family command compiles once, runs all four existing builders (including their actual
bundled refusal probes), then copies release companions into the family output. Individual
builder output paths remain available. PowerShell 5 and 7 publisher tests pass, including
mixed/incomplete/duplicated receipt refusals; scoped Biome checks pass. Actual packaging and
integrity validation pass at clean `e95e4ecacf027c83996fa89b6b95d0cea6a34527`. A second packaging
pass over the same compiled source produces sixteen identical files; this is not two clean
compilation runs or the publisher's complete pre-publication/audit sequence.

ZIP contents, source identity, bundle and ZIP hashes, byte lengths/base64 digests, checksum
companions and CycloneDX SBOM hashes/component counts pass independent local inspection.

| Artifact | ZIP SHA256 | Bytes | Components |
|---|---|---:|---:|
| native-application-preparation-lambda | `9a8543b664091b4f34bd3bc641cb2b79f9c14e84b5297e77aa2a2fd750939446` | 675577 | 46 |
| application-preparation-durable-lambda | `64f169c47cd64b0477be5fbc1f7ab90a05fd9dff73816750b0773b37623fe4e6` | 363691 | 31 |
| application-preparation-starter-lambda | `39283acb4be12eab2433cc2f56ef69ee846c8fee0873998031dd43f207311714` | 439742 | 35 |
| application-preparation-recovery-lambda | `683563aca284500b6767b37f779c6a88d1a2e985834a04091ae8dc1c386504c9` | 453583 | 35 |

Ignored logs and hash inventories are `.tmp/d3-native-preparation-{publisher-tests*,family-*}`.
No runtime TypeScript changed. Bootstrap ceilings, queue/network/key policies, outbox wiring,
alarms and development/staging composition remain the next connected source steps, followed by
managed acceptance. Existing dependency advisories remain open; no fresh audit or waiver is
claimed. All artifacts remain unpublished, Docker/WSL stopped, PC on.

## Bootstrap composition

Bootstrap now accepts optional `native_preparation_releases`, validates exact original release
IDs and same-account/environment keys, secret, queues and numeric launcher, and provisions a
shared boundary per original release. Each permission has an exact `aws:PrincipalArn` condition:
only activity receives packet cryptography/launcher access, only durable receives checkpoint
and activity invocation, only starter receives workflow invocation/queue consumption, and only
reconciler receives nudges. Terminal/reconciler receive original execution metadata and failure
retention grants. No preparation ceiling permits S3 content, ECS launch or PassRole. Sharing the
policy does not share per-role capabilities. Runtime module boundary names now match bootstrap.

Deployment authority admits only the named preparation boundary ARNs and original durable stacks;
ordinary role management still cannot change permissions boundaries. Empty input preserves the
original string/list policy representation. The first implementation with five separate boundary
references exceeded IAM's managed-policy limit when combined with an original resume/DNS release.
One principal-conditioned boundary per preparation release removes repeated references and passes
that combined test without widening runtime permissions or removing retained releases. A size
precondition rejects future oversized combinations. Retained releases must not be discarded to fit.

All 12 bootstrap mock scenarios and seven preparation-module mock scenarios pass with Terraform
1.16.2/AWS provider 6.58.0. Coverage includes default unchanged authority, exact role restrictions,
packet/nudge separation, foreign launcher rejection, original resume/DNS coexistence under 6,144
characters and runtime boundary-name agreement. Existing workload/restore/resume tests pass.
Terraform validation, formatting, serverless infrastructure policy validation and diff whitespace
checks pass. Logs: `.tmp/d3-native-preparation-bootstrap-tests.log` and
`.tmp/d3-native-preparation-runtime-boundary-tests.log`. No AWS API, apply or effective-IAM
acceptance; this is source/mock evidence. Queue/key resource policies, private endpoints, outbox,
alarms and development/staging composition are still to be connected. D1/D3 remain In progress.

## Platform and environment composition

Development and staging now expose empty-by-default original preparation release maps, with
at most one new-work intake owner. The platform supplies dedicated encrypted standard queues,
360-second visibility, bounded redrive, fourteen-day failure retention, TLS queue policies,
original EventBridge delivery grants and durable-state key grants. Private Lambda, SQS and
Secrets Manager endpoint policies admit exact actor/resource pairs. A private KMS endpoint
admits only activity packet encryption/decryption and fingerprint generation. Nineteen alarms
cover queue depth/age, retained failures, function errors/throttles, EventBridge delivery/DLQ
failures and Lambda destination failures. All activation switches remain false by default.

Three focused preparation Terraform mock scenarios and twelve existing resume network/RPC/
secret scenarios pass. Development and staging validate using Terraform 1.16.2 and AWS provider
6.58.0; formatting, serverless infrastructure validation and diff whitespace checks pass.
This is source/mock verification, not AWS IAM, cloud deployment or a live candidate journey.

Inspection found a remaining recovery defect: SQL nudge and execution-reconciliation claims
are global rather than scoped to retained original function versions. A newer release can
claim older work that its runtime correctly refuses. Scope claims and verify retained-release
drain before activation, including lost start acknowledgements when new intake is disabled.
The KMS endpoint enables VPC private DNS: inventory other enabled KMS callers and reconcile
their exact access before applying it. Packet key policies, native launcher/task/owner/route
composition and managed acceptance remain. No publication, deployment, activation or CI/CD
work; Docker/WSL remain stopped, PC on. D1 and D3 remain In progress.

## Original-release recovery and drain

The global recovery-claim defect identified above is corrected. Native reconciliation passes
its retained numeric function allowlist into SQL; both nudge and execution-poll queries filter
before taking a lease. Unbound work is admitted only by the configured intake owner. The
starter also checks the retained allowlist and unbound-intake permission under the owning SQL
lock, before mutating dispatch state. A queued message cannot bypass drain restrictions.

A default-off `drain_enabled` switch is connected through development/staging and the runtime
module. With recovery enabled, it keeps starter consumption and recovery nudges running while
`APPLICATION_PREPARATION_INTAKE_ENABLED=false` refuses new unbound work. Bound work still
reuses its original numeric function and named execution. Original runtime versions, activity
configuration, roles and keys must remain available until verified drain; publishing a new
disabled version does not withdraw an old version. No original work is retargeted.

Verification on the local branch: Applications compilation and Workflow typechecking pass;
101 existing dispatch/recovery/bootstrap unit tests pass; 28 Applications PostgreSQL tests and
25 actual starter/recovery-runtime PostgreSQL integration cases pass. New cases cover foreign
release exclusion before leasing, invalid allowlists, retained-version draining, unbound
refusal, and a bound request with no acknowledged execution receipt. These use fresh isolated
PostgreSQL 16.14 databases and simulated AWS Lambda/SQS and secret resolution, not remote AWS
execution. The initial SQL run exposed JSON parameter double encoding; using the PostgreSQL
client's explicit JSON binding corrected it, and all affected suites were rerun successfully.

Eight preparation Terraform mock scenarios pass, including drain without intake; development
and staging validate. Serverless policy validation, touched-file formatting/lint and diff
whitespace checks pass. No new schema or migration, frontend change, cloud action or activation.
Temporary PostgreSQL container removed; Docker/WSL stopped and PC retained. Native launcher/
task/owner/route composition, packet-key/private-DNS coexistence and managed acceptance remain.
D1/D3 remain In progress; CI/CD is deferred to production launch.

## KMS private-DNS coexistence

Source inventory identified direct KMS SDK calls in the gateway vault and deletion-confirmation
journal, candidate-rights activity export/recovery ledger, and restore operator. The new private
KMS endpoint would have denied those existing owners when preparation enabled private DNS.
Its policy now preserves their exact role/key/action pairs only when the corresponding existing
feature is configured. Vault operations require `restricted-answer-vault-v1`; deletion locators
require `candidate-deletion-recovery-v1`. Export and restore remain decrypt-only, gateway
locator access remains encrypt-only, and none receives preparation packet-key access.
Service-mediated S3/SQS/Secrets Manager encryption does not require caller endpoint grants.

The coexistence mock plan combines preparation, vault/export, candidate rights and restore,
and verifies seven endpoint statements, exact principal roles, key separation and purpose/action
limits. The three preparation and three restore scenarios also pass. Both environments validate;
serverless policy validation, Terraform formatting and diff whitespace checks pass. No AWS IAM
or network acceptance, deployment or activation is claimed. Packet-key provisioning and the
future native packet owners must still be connected explicitly; D1/D3 remain In progress.

All 51 existing serverless-runtime Terraform mock scenarios also pass after this change
(`.tmp/d3-preparation-kms-existing-tests.log`), for 58 passing scenarios in this batch.

## Retained packet-key provisioning

Development and staging now expose default-off `restricted_packet_keys_provisioned` separately
from release activation. The platform creates a dedicated symmetric encryption key and an
HMAC_256 / GENERATE_VERIFY_MAC key, matching the runtime's AES-256 envelope data keys and
HMAC_SHA_256 fingerprints. Key bindings are outputs for the reviewed bootstrap/release inputs;
provisioning does not activate callers, queues, endpoints or a preparation release. Both keys
have thirty-day deletion windows and Terraform destruction protection. Encryption rotation is
enabled; HMAC rotation is deliberately omitted, consistent with
[AWS HMAC documentation](https://docs.aws.amazon.com/kms/latest/developerguide/hmac.html).

Account IAM delegation follows the platform's existing key ownership model. An explicit deny
rejects other envelope encryption purposes (including missing context), while the fingerprint
key rejects other MAC algorithms. No caller-specific allow is added by provisioning; actor IAM,
boundaries and endpoint grants remain independently required. The two packet keys are separate
resources from each other, the shared platform CMK and the restricted-answer vault key.

Three key-provisioning mock scenarios pass: empty default, correctly typed/purpose-bound keys
without activation, and refusal without the retained data plane. The four preparation/KMS
coexistence scenarios also pass. Both environments validate with Terraform 1.16.2/AWS provider
6.58.0; formatting, serverless policy validation and whitespace checks pass. This is source/mock
evidence, not provisioned keys or effective KMS/network acceptance. No cloud change or CI/CD
work. Packet-owner/native-task/route composition and managed acceptance remain; D1/D3 In progress.
Docker/WSL remain stopped and PC on.

## Current recovery artifact family

The complete preparation family was rebuilt after release scoping/drain and packet-key wiring
at clean committed source `14bffe942047abb815daa157b315c89ee55d5139`. Workflow and all owning
service dependencies compile. All four original builders' bundled refusal checks pass, and
five independent bundle-boundary checks pass, including absence of private/provider/Invoke
actors from recovery and absence of model/ECS/rendering actors from preparation.

The first build used the builder's default `local` provenance label; the independent manifest
check rejected it as release evidence. Repackaging the same compiled source with exact
`ARTIFACT_SOURCE_SHA` produced the qualified family below. All sixteen ZIP/manifest/checksum/
SBOM companions pass source identity, embedded source marker, bundle hash, ZIP hash/length/
base64 digest and SBOM hash/component-count checks. This is one source compilation and one
qualified packaging pass, not a repeated clean reproducibility build or publisher execution.

| Artifact | ZIP SHA256 | Bytes | Components |
|---|---|---:|---:|
| native-application-preparation-lambda | `73d468c3eedc0a7fbe4aed141ef2f3bc30329f86220ea1a092096a33a6979f41` | 675864 | 46 |
| application-preparation-durable-lambda | `aceedb87385cb9541ae87cd73eab13fb9fa14713340bfa76b4b0d166b84d133c` | 363691 | 31 |
| application-preparation-starter-lambda | `bb82cd485bd3b1fd96f0c4976f92b88ccef987c0b5c84d4cd237ff378efd61c3` | 440086 | 35 |
| application-preparation-recovery-lambda | `0d3108f678cace0dfb4aca6faea6f79e23f2019ad7baaee7d9b11e1858ceaf37` | 453903 | 35 |

Local logs/inventory: `.tmp/d3-preparation-family-current-build.log`,
`.tmp/d3-preparation-family-current-packaging.log`, and
`.tmp/d3-preparation-family-current-integrity.json`. Artifacts remain unpublished under
`backend/workflows/dist/native-preparation-family`. No fresh audit, cloud deployment or managed
acceptance is claimed. Native task/launcher/owner/route infrastructure still needs composition;
D1/D3 remain In progress. Docker/WSL remain stopped; PC on and CI/CD deferred.

## Native cover-letter task composition

A new `native-material-task` module registers the original digest-pinned cover-letter task and
bounded task/execution roles, exposed through empty-by-default development/staging release maps.
The task uses the existing native image entrypoint, unprivileged UID, init, read-only root,
dropped capabilities, no core dumps and no persisted/logged content. Task IAM admits one exact
numeric owner RPC and distinct provider/TLS secret versions; each key decrypt grant is limited
to Secrets Manager and that secret's context. Execution IAM pulls only the named image repository.
No ECS service, launcher invocation, route, runtime flag or provider activation is added.

Eight mock Terraform scenarios pass: absence, task/role envelope, foreign account/environment,
registered-revision mismatch, unpinned provider secret, duplicate secrets and owner alias refusal.
The actual mocked task definition was translated into the AWS SDK response shape and accepted
by compiled `validateNativeTaskDefinition`; a resume entrypoint substituted into it was rejected.
Module and both environment configurations validate with Terraform 1.16.2/AWS provider 6.58.0.
Formatting, serverless infrastructure validation and diff whitespace checks pass. Ignored local
fixtures: `.tmp/d3-native-material-task-tests.jsonl` and
`.tmp/d3-native-material-task-projection.json` (synthetic metadata only).

This is source/mock compatibility, not an ECS registration, image run or effective IAM proof.
Native launcher/owner/task-event Lambdas, endpoint/secret policies, provider egress and read-route
composition plus managed acceptance remain. Original roles/secrets/keys must outlive their work;
a mismatched task revision is detected after registration and does not undo it. No AWS action,
publication, deployment or activation; Docker/WSL stopped, PC on, CI/CD deferred. D1/D3 In progress.

## Native launcher, owner and task-event composition

`native-material-control` now composes the three existing handlers as separate numeric Lambda
versions, exposed through optional development/staging release maps. Launcher/owner receive
private SQL and no provider secret. Only launcher may RunTask on the original definition/cluster
and PassRole its original task/execution roles; StopTask and Lambda invocation are denied. Owner
is denied ECS, PassRole and Lambda invocation. Task-event has no VPC/database secret or ECS
permission and targets only the numeric original launcher through its recover-only code path.
All actors deny S3. New launch requires owner/control/recovery; recovery remains independent
of new-launch activation. Default empty maps and false switches create no active journey.

Six Terraform mock cases pass, covering absent/default configuration, bounded role/environment
bindings, recovery with new tasks disabled, activation prerequisites, foreign-account refusal
and missing-release refusal. Module and both environment configurations validate with Terraform
1.16.2/AWS 6.58.0. The actual generated launch JSON passes compiled
`nativeTaskLaunchConfiguration`, verifying its field/network/image/task contract. Formatting,
serverless infrastructure validation and diff whitespace checks pass. Logs/projection are
`.tmp/d3-native-material-control-tests.jsonl` and
`.tmp/d3-native-material-launch-configuration.json` (synthetic metadata).

No publication, deployment, invocation or activation occurred. The exact launcher bootstrap
boundary/creation authority, guarded three-artifact publisher family, original platform endpoint
permissions, EventBridge delivery/failure retention/alarms and image/read-route composition still
need integration before managed acceptance. Existing TypeScript runtimes are unchanged. D1/D3
remain In progress; Docker/WSL stopped, PC on, CI/CD deferred.

## Material control bootstrap and publisher

Bootstrap now provisions the exact launcher ceiling used by native material control, with
original-principal conditions on every grant. It permits only original task/cluster launch,
metadata reads, the owning database/configuration key and PassRole of the two original task
roles; no StopTask, object content or Lambda Invoke. Optional deployment authority can read/use
these exact ceilings, preserving empty-input authority and the ordinary-role prohibition on
changing boundaries. All sixteen bootstrap mock scenarios pass, including combined retained
resume/DNS, preparation and native material control within the 6,144-character policy limit.

The guarded publisher adds `NativeMaterialControls`: three artifacts/twelve companions, a
separate receipt kind/operator directory and `lambda/documents/native-material/control` root.
Its family builder compiles dependencies once and stages original launcher/owner/event artifacts
without changing standalone paths. Both publisher build passes select this family; existing
source/merge/audit/versioning/readback gates remain unchanged. PowerShell 5 and 7 family/receipt
suites pass including case variants and mixed/duplicate/incomplete receipt refusal. No publisher
cloud action ran. Comparing the actual publication contract caught an incorrect Terraform key
layout from the prior control-module commit; it now expects `<source>/<artifact-sha>/<name>.zip`.
All six control-module mock cases pass after that correction. Actual family packaging is the
next local check; no build/provenance claim is made by these selection tests alone.

Terraform bootstrap validation, formatting, serverless infrastructure validation and whitespace
checks pass. No AWS action or CI/CD execution. Platform event/failure retention/alarms, private
network permissions and native image/read-route acceptance remain; D1/D3 In progress.

## Built native material control family

The new family command compiles Workflow and owning dependencies and builds all three original
artifacts at clean source `483498f21f364ed510399dbce591371d7995c34f`. All original builders'
bundled refusal checks pass; seventeen emitted control/owner/resume capability-boundary tests
pass. Independent inspection verifies all twelve companions, exact manifest/embedded source,
ZIP byte lengths/SHA256/base64 digests, bundle hashes and SBOM hashes/component counts.

| Artifact | ZIP SHA256 | Bytes | Components |
|---|---|---:|---:|
| native-material-launch-lambda | `75f919bfd63bb9b74f5a86ea04a5d7e7654fb86a23c285a0d97fdca581119cd7` | 297876 | 28 |
| native-owner-rpc-lambda | `6ed299c14b7f802da9aec92304faf6586731cc838851578d95055f7e2e5e11bb` | 369458 | 36 |
| native-material-task-event-lambda | `4ef7ad0408ffc3e0e2ed513f145bf1d4f530c37518aa05c4521b9759e8fe8d04` | 265071 | 25 |

Artifacts remain local under Workflow `dist/native-material-control-family`. Logs/inventory:
`.tmp/d3-native-material-control-family-build.log` and
`.tmp/d3-material-control-family-integrity.json`. One qualified family build is proven, not
repeated clean reproducibility, a fresh dependency audit or publisher cloud execution. Platform
event/failure retention/alarms and private network integration remain before image/read-route
managed acceptance. D1/D3 In progress; no cloud action, CI/CD deferred, Docker/WSL stopped, PC on.


## Native material task-event delivery

Original task state changes now target the numeric original event-handler version with exact
account, region, cluster and task-definition matching. The rule stays disabled until recovery
is enabled. EventBridge retries delivery for up to one day; Lambda retries asynchronous handler
failure twice within six hours. Both paths retain failures in the original encrypted queue for
fourteen days. Queue/key grants bind EventBridge to the original rule; the handler can send only
to its original failure queue. Ten alarms cover queue depth, delivery/destination failures and
errors/throttles on the three control functions. Retention remains independent of activation.

Local verification on 2026-10-07: six control-module and three platform observation Terraform
mock scenarios pass; development and staging configurations validate with Terraform 1.16.2.
These are local configuration checks with simulated AWS resources, not deployed event delivery.
Private-network access, image/read-route composition and managed acceptance remain. No cloud
publication or activation; D1/D3 remain In progress, CI/CD deferred, PC stays on.


## Native material private network

Development and staging derive original network bindings from retained task/control releases.
The existing private ECS endpoint admits only the original launcher to RunTask on its exact
cluster/definition without ECS exec, and to describe original tasks/definition metadata. Resume
control/observer rules coexist in that same endpoint. Shared Secrets Manager grants separate the
launcher/owner database secret from the task's two version-pinned provider/TLS reads; shared
Lambda access binds the task principal to its numeric original owner. No direct KMS endpoint
access is needed for these service-mediated secret decryptions.

Inspection found SQL ingress previously accepted only the shared application group, leaving
custom preparation/control groups unable to connect. SQL ingress now includes those declared
groups. Material task groups are excluded, and overlap with any SQL-authorized application,
preparation or control group is rejected. Existing ECS endpoint resource addresses and immutable
security-group description are retained to avoid unnecessary replacement. Registering a task
before its control release admits no task source group and does not prove launch readiness.

Local Terraform 1.16.2 checks: seven new network scenarios pass, covering absence, resume
coexistence, pinned access, registration ordering, foreign cluster/owner-alias refusal and SQL
group reuse refusal. Fifteen affected existing scenarios pass (five resume network, three resume
RPC, four resume secrets, three preparation). Both development and staging validate; whitespace
checks pass. Mock tests inspect generated configuration and policy statements with simulated AWS
resources, not live connectivity or effective managed IAM. No cloud changes were made.
Image/provider/read-route composition and managed acceptance remain; D1/D3 In progress.


## Native material address discovery

The missing cover-letter address port now reads the original claimed launch configuration and
current ready receipt, validates signed ECS task/image/overrides and exact EC2 interface,
account/subnet/groups/public IPv4, then repeats task and owning admission checks. A changed work
binding, retirement, withdrawn readiness, expired reference, timeout or mismatch withholds the
result. Return values contain only original allocation/task/interface/address/expiry metadata.
The existing resume reader now uses the same AWS observation implementation; its original
ledger-specific admission remains separate. Launcher and observer share the exact cover-letter
scalar override constructor to prevent differing work identities.

The control module and both environments expose `task_public_ip_enabled`, false by default.
Explicit public task networking changes only the pinned launch configuration, not launch flags,
security-group ingress or DNS. Public subnets, provider reachability, route-owner composition,
EC2 IAM/private endpoint access and checkpointed DNS create/remove lifecycle still need connection
and managed verification. This work does not claim the download path is functional end to end.

Local verification: 119 material/resume address and launcher tests pass with synthetic owner/AWS
ports. Seven control Terraform mock scenarios pass; development and staging validate. Documents
compilation and touched-file Biome checks pass. No database schema or persistence implementation
changed. No AWS publication, deployment or activation; D1/D3 remain In progress.

Eight emitted control/resume capability checks also pass after compiling Documents; the sixteen
new material address cases pass again after the test-only TypeScript correction.


## Native material route owner and lifecycle

The private cover-letter route owner pins a detached original evidence binding, launch hash,
ready reference and reviewed DNS configuration. Capture checks exact launch/work/deployment and
current owning admission before/after the existing signed task-address reader. Admission repeats
capture and requires the same address/expiry snapshot. Retirement accepts only the matching
original ledger's positive retired state and remains independent of sealed/expired creation
admission; absence/errors are never retirement. No SQL transaction spans AWS network calls.

Resume and material now share the existing durable DNS algorithm. Existing resume checkpoint
names remain unchanged; material uses separate `material-route.*` names. Both checkpoint intent
before the single create, wait for propagation before attachment, preserve ambiguous writes and
attachment acknowledgements, and remove the exact record after original expiry or positive
retirement. New-creation shutdown preserves cleanup. DNS removal does not prove task death,
provider settlement or candidate-rights disposal.

Seventeen cover-letter owner cases pass with synthetic registry/address ports. The full existing
DNS lifecycle suite now runs against both kinds: thirty-two local durable-SDK cases pass, including
the actual DNS adapter with synthetic transport and interrupted create/attach/remove operations.
This is local implementation, not deployed routing. Private invocation/dispatcher ownership of one
original execution, atomic attachment, EC2/Route53 permission composition and managed acceptance
remain. No database implementation or schema changes; D1/D3 remain In progress.

Workflows compilation, touched-file Biome checks, whitespace checks and all eight emitted
control/resume capability-boundary checks pass on this source.


## Private material route control

The existing material-launch handler accepts a separate strict `native-material-route.v1`
envelope for capture/admit/retired. Launch/recover v1 inputs and outputs remain unchanged. The
new exact-version Lambda client validates detached binding/reference/snapshot and matching reply,
uses one signed regional attempt, refuses log-bearing/error/foreign-version replies and preserves
admission until its transport settles. The default-off receiver pins original managed-secret,
public task and DNS configuration, and lazily composes the owning registry, allocation reader,
signed address reader and route owner. New-launch enablement is not required for route recovery.
No DNS write, task stop, new generation or packet attachment is provided by these actions.

Optional route configuration/activation is wired through development and staging. Activation
requires original control, reviewed DNS binding and public task mode. Shared EC2 endpoint access
is added only for the original material launcher, preserving resume access and existing endpoint
addresses. Existing VPC IAM and bootstrap ceiling already permit DescribeNetworkInterfaces.
No new Lambda deployment or Route53 permission is added.

The emitted check caught readiness-store publishing/rendering dependencies entering the read-only
route control. The unchanged readAllocation implementation was extracted into a dedicated read-only
store; the existing ready store inherits it. The final control bundle excludes rendering, model,
object storage, packet writing, DNS mutation and Lambda invocation; the sender has Lambda only.
No SQL query, migration or persistence semantics changed; real PostgreSQL was not rerun for this
mechanical extraction and local ports do not establish live database/network behavior.

Local checks: 68 private receiver/launch/owner cases and 37 affected Documents cases pass;
21 Terraform control/network scenarios pass; both environments validate. Documents and Workflows
compile and touched-file Biome/whitespace checks pass. Nine emitted capability checks pass.
Production remains disabled/unpublished. Original durable dispatch, propagation-gated attachment,
Route53 composition, managed image/provider/routing and accountable acceptance remain.


## Rebuilt route-capable control family

All three original control artifacts were rebuilt from clean source
`c71cdaad4e7026a2c7fa8c0cf0363834c49e93dd`, using the just-compiled Documents/Workflows output.
Bundled refusal checks include the new route protocol through the actual combined entrypoint.
Independent inspection verifies all twelve companions, exact source/embedded marker, ZIP
bytes/SHA256/base64, bundle SHA256 and SBOM hash/component count. This is one qualified local
packaging pass, not repeated clean reproducibility, fresh dependency audit or managed acceptance.

| Artifact | ZIP SHA256 | Bytes | Components |
|---|---|---:|---:|
| native-material-launch-lambda | `20e1dfa4c178297d20aaa18698e6f24dc4e0b74f71a9866f32590e8d739dca42` | 619545 | 30 |
| native-owner-rpc-lambda | `c4d796d084dcb9c5ab85567091650dc793c39475f21b845d869a8fba84ab3196` | 369437 | 36 |
| native-material-task-event-lambda | `198cf5ff01121396e8e19135db899b90f1c5b0efb4ac5308db299a837877ee66` | 265068 | 25 |

Local logs: `.tmp/d3-material-route-control-build.log` and
`.tmp/d3-material-route-control-integrity.json`. Artifacts remain unpublished. Durable original
route dispatch, propagation-gated attachment, cloud/managed acceptance remain; D1/D3 In progress.


## Connected preparation staging and attachment

The original preparation activity now has an optional private stage/attach protocol. Staging
uses the existing single generation claim and ready receipt but does not complete the packet.
Attachment recovers that same material, reloads current context/vault references, compares the
original allocation/work/reference, and calls the existing atomic packet completion. A changed
reference, missing original claim or terminal operation cannot cause fresh generation.
Documents provides a read-only original binding lookup with current readiness rechecks.

The existing preparation durable entrypoint optionally checkpoints staged scalar metadata,
invokes the original private route control, waits for DNS propagation and then attaches through
the numeric preparation activity. It uses the existing event/execution binding and shared DNS
cleanup lifecycle. Lost attachment acknowledgement does not cause another attachment; cleanup
still runs. Separate creation shutdown preserves cleanup. Existing non-routing behavior stays
available; the new mode defaults off and cannot use legacy advance to bypass propagation.

Local PostgreSQL 16.14 integration passes all 25 cases, including original binding lookup,
stage/replay without completion, attachment, terminal replay and sealed-reference refusal.
Lambda/ECS/provider and packet protection in that suite are synthetic. The connected local SDK,
activity/bootstrap and shared lifecycle suites pass 104 cases; twelve emitted capability checks
pass. The durable bundle permits only enumerated pure Documents metadata modules, numeric Lambda
transport and DNS adapter, retaining exclusions for SQL, models, content, ECS/EC2 and KMS clients.
Workflows compiles. These results do not establish managed AWS behavior or UI acceptance.

Cloud wiring remains: preparation Route53 permissions and bootstrap ceiling, routing flags,
longer durable timeout for cleanup, environment composition, rebuilt immutable preparation
artifacts and managed acceptance. Nothing was published, deployed or activated. D1/D3 remain
In progress. Per owner direction, implement connected batches, exercise them, then fix failures
and add focused regressions; defer hosted CI/CD until production launch.


Batch-wide verification: 38 workspace typecheck tasks, 39 workspace test tasks and 23 build tasks
pass (32/35/19 respectively served from valid task cache). Repository formatting passes;
lint has no errors and retains 15 warnings/58 informational diagnostics. The one full
`verify-phase0.ps1` attempt stops at candidate-rights session fixtures: their exclusive
127.0.0.1:3000 listener cannot bind while the existing development service occupies that port.
A separate local bind probe confirms EADDRINUSE. The server was preserved. This is not a full
verifier pass; subsequent typecheck/test/build commands ran separately. Logs are
`.tmp/d3-preparation-stage-{verify,typecheck,tests,build,format,lint}.log`.
The owned temporary PostgreSQL container was removed; Docker Desktop and WSL are stopped.
The PC remains on. No browser sign-in or previously accepted human checks were repeated.


## Preparation routing release composition

Preparation Terraform and both environment maps now forward the optional original DNS binding,
route lifecycle flag and independent creation flag. Routed intake requires route creation;
original drain/cleanup can remain enabled with creation off. The activity and durable runtime
receive matching route mode and the original numeric material-control target. Configured routing
has a 3600-second execution window for preparation plus expiry/cleanup; legacy configuration
retains 900 seconds. The version identity includes timeout as well as environment configuration.

Only the routed durable role receives A-record CREATE/DELETE for UUIDv7 allocation hostnames
within the exact original hosted zone, zone inspection and change observation. Bootstrap gives
that actor a separate principal-bound ceiling; the original shared ceiling remains unchanged.
This avoids exceeding the 6144-character managed-policy limit without broadening other roles.
No UPSERT, SQL secret, packet cryptography, ECS launch or object access reaches the durable actor.
Bootstrap/workload/control route inputs must agree and stay retained until original work drains.

An upgrade check also found that retaining a workflow did not retain its activity invocation
permission. `retained_activity_versions` now preserves an explicit bounded numeric set alongside
the current activity; callers must list activities referenced by their retained workflows.
Existing actor permissions and empty environment defaults are preserved. These versioned flags
do not disable an already published version remotely.

Local Terraform 1.16.2: 17 preparation module scenarios and five bootstrap scenarios pass,
including routed cleanup, exact grants, policy size, resume coexistence and retained activity
access. Development and staging validate. Infrastructure policy validation, touched JavaScript
Biome and whitespace checks pass. No database/runtime source changes in this batch; the preceding
38/39/23 local typecheck/test/build results remain the runtime evidence. The broad verifier's
port-3000 sign-in-fixture conflict remains recorded above; it was not rerun for these Terraform
and packaging changes. Docker/WSL were not started. No AWS publication, deployment or activation.
Updated builders include route-protocol default-off refusal in the actual bundled entrypoints.
Rebuilt immutable artifacts and managed synthetic acceptance remain before activation.


## Rebuilt routed preparation family

The four preparation artifacts were rebuilt from clean source `c194a979a9e3d45781befe8582bec5750c23f4c8`.
The family command compiles its workspace dependencies and runs each original builder, including
bundled route-protocol default-off refusals. Independent inspection verifies all sixteen
companions, exact source/embedded marker, ZIP bytes/SHA256/base64, bundle SHA256, SBOM hash and
component count. This is one qualified local packaging pass, not repeated clean reproducibility,
a fresh dependency audit or managed acceptance. The additional twelve shared bootstrap/material
scenarios pass, making 34 relevant Terraform cases for this batch.

| Artifact | ZIP SHA256 | Bytes | Components |
|---|---|---:|---:|
| native-application-preparation-lambda | `98434f858c187a865496b42a17a2bbd8c1f2afa0efc6cba02fc4cc4c553cde1a` | 678304 | 46 |
| application-preparation-durable-lambda | `ec9e03883d3f468f314e35822abb9194850eef15021b634f1d32119424d20e23` | 482706 | 33 |
| application-preparation-starter-lambda | `5d34aadcbe5ea4dc92267a4fdad7022be1c2f11069d097fd53f6dd765680dad0` | 440087 | 35 |
| application-preparation-recovery-lambda | `f2a89082ab4933ad7550da76cbbbfadefe13154b097b455ba6eddcf263fe793f` | 453903 | 35 |

Local build/integrity logs: `.tmp/d3-preparation-routed-family-build.log` and
`.tmp/d3-preparation-routed-family-integrity.json`. Artifacts remain unpublished. Actual original
image/provider/TLS/network binding, managed synthetic end-to-end/recovery/drain/disposal evidence
and accountable client/ATS/security acceptance remain. D1/D3 remain In progress. Docker/WSL were
not started; PC on, hosted CI/CD deferred and no cloud mutations.


## Connected PostgreSQL route lifecycle

The existing original-owner SQL integration now continues through the actual preparation
activity, installed durable SDK, owning route admission, DNS adapter, atomic packet attachment,
location lookup and retirement observer. Staging replays against real PostgreSQL without packet
completion. At DNS creation, the operation is still running. Attachment follows propagated DNS,
recovers the exact staged reference and makes the current location available. Simulated
AWS transport supplies an exact STOPPED observation; the real retirement observer validates it,
the owning registry records it, and the durable route lifecycle removes that exact A record.
SDK replay produces one stage invocation, one creation, one attachment and one removal. No extra
task or generation is permitted. Retired/sealed material becomes unavailable.

All 25 real PostgreSQL 16.14 integration cases pass, including this connected case, and Workflow
typecheck passes. The first run exposed the local SDK's global fake timers disagreeing with SQL
wall-clock deadlines; this integration now explicitly uses real timers. Production timeouts and
validation are unchanged. Lambda transport, task/ENI metadata, DNS replies, STS, provider output
and packet protection are synthetic; no real AWS task, provider call, DNS write, user browser or
physical-purge acceptance is claimed. Runtime source and qualified artifact identities remain
unchanged. Full verification was not repeated for this test-only change; the previously recorded
port-3000 conflict and broad typecheck/test/build evidence remain the applicable limits.

D3-079 and D3-068 through D3-071 now distinguish implemented release composition from unfinished
managed acceptance instead of listing already implemented components as missing. Prior component
history stays intact. The owned temporary PostgreSQL container was removed; Docker Desktop/WSL
stopped and PC on. D1/D3 remain In progress. No cloud action or CI/CD work.


## Native HTTPS and image reachability

The connected implementation review found two network gaps: original native tasks lacked a
dedicated candidate HTTPS security group, and migration ECR private DNS intercepted their image
pulls while admitting only the migration execution role. Platform composition now provides
optional separate cover-letter/resume task groups, explicit reviewed IPv4 TCP 8443 ingress,
TCP 443 egress and outputs for the existing public subnets plus required public-IP launch mode.
Empty ranges explicitly close ingress. Provisioning does not launch or activate a task or route.

Development/staging derive exact original execution-role/repository grants and task groups from
retained release maps. Existing ECR endpoints admit those image pulls through a separate TLS
endpoint group; the migration log endpoint and its original security group remain unchanged.
No SQL grants, NAT, DNS records or duplicate ECR endpoints are introduced. Task registration may
precede launch configuration. Retain original entries through drain. TCP 443 egress is not a
hostname firewall. The [platform instructions](../../../../infrastructure/terraform/modules/platform/README.md#native-task-https-reads-and-image-pulls)
describe provisioning first and copying reviewed scalar bindings into original releases.

The 22 focused Terraform scenarios pass, including exact image principals/resources, ECR-only
endpoint attachment, retained migration isolation, invalid role/account refusal, separate read
groups, closed defaults and invalid client ranges. Development/staging validate and the serverless
infrastructure guard passes. All 51 existing serverless runtime scenarios also pass, for 73
relevant Terraform cases in this batch. Terraform uses mocked AWS resources: this proves local configuration,
not image-pull success, public-IP/TLS/provider reachability or candidate browser acceptance.
Runtime source and qualified artifact identities remain unchanged. Actual managed inputs and
synthetic end-to-end acceptance remain before activation. D1/D3 remain In progress; no cloud
mutation, hosted CI/CD or Docker work occurred, and the PC remains on.


## Gateway native material release wiring

Tracing the candidate read path found a release gap: Gateway runtime already implements native
location/authorization and packet protection, but platform Terraform supplied none of their
settings or packet-key permissions. Optional `gateway_native_materials` now composes those exact
runtime variables, separate cover-letter/resume hostnames and retained encryption/HMAC key ARNs
into the existing Gateway. Null preserves the previous deployment; `{}` provisions permissions
with all switches false. Validation requires protection before authorization, authorization and
a reviewed hostname before locations, and resume locations before resume intake.

Gateway IAM grants only GenerateDataKey/Decrypt for the exact packet encryption key with its
packet purpose and GenerateMac for the exact fingerprint key with HMAC-SHA-256. The existing
private KMS endpoint now also serves a configured Gateway before preparation releases exist,
retaining other legitimate caller statements. Its new grants pin the Gateway principal and exact
keys. Gateway publication depends on its new role policy and endpoint. Bootstrap has a separate
optional exact fingerprint-key input adding only the Gateway's MAC operation to the existing
workload ceiling; the populated policy remains within IAM's size limit. No generic environment
map or broad new KMS grant was introduced.

All 23 relevant Terraform cases pass: eight candidate API composition/refusal cases, three exact
Gateway boundary cases, five existing preparation boundary cases, and seven preparation/private
KMS/retained-key cases. Both environments validate and the infrastructure guard passes. These
are mocked AWS plans and configuration checks, not deployed KMS/identity/DNS/browser acceptance.
Runtime source and existing qualified artifact identities are unchanged. The last broad workspace
checks and known full-verifier port-3000 fixture conflict remain recorded above; this Terraform-only
batch does not rerun that unrelated fixture.

[Platform instructions](../../../../infrastructure/terraform/modules/platform/README.md#gateway-native-material-release)
state the key-first bootstrap/Gateway sequence and exact host alignment. Compatible preparation,
export/rights and migration releases plus managed synthetic flow acceptance still precede runtime
activation. D1/D3 remain In progress. No cloud action, CI/CD, frontend edit or Docker work; PC on.


## Protected packet export release wiring

The existing private candidate-rights activity already composes the Applications-owned protected
packet export reader, but Terraform lacked its environment, exact-key IAM and private KMS
endpoint grant. Both environments now expose `restricted_packet_export_enabled`, false by
default. Enabling it requires retained packet keys and candidate rights with Applications in the
accepted owner inventory. The activity receives the existing export flag, encryption key and
fingerprint identity. Its role and endpoint grant only Decrypt on the packet encryption key,
restricted to `restricted-application-packet.v1`. No packet writes, data-key generation or MAC
permission is granted. The original tagged-key workload boundary already covers that decryption.
Activity publication waits for the export policy and KMS endpoint resources.

Export can establish its KMS path independently of preparation releases; pausing generation need
not remove candidate portability. Existing Gateway, vault, recovery and preparation endpoint
grants remain intact. The [platform instructions](../../../../infrastructure/terraform/modules/platform/README.md#gateway-native-material-release)
require a compatible, verified export release before protected packet writes and retaining keys
through the lifetime of stored packets.

Fourteen relevant Terraform scenarios pass: five export cases (coexistence, independent export,
default-off, missing prerequisites, missing Applications owner), eight Gateway native cases and
the existing shared KMS regression. Development/staging validate, the infrastructure guard and
whitespace checks pass. AWS plans are mocked. Runtime source, SQL and artifacts are unchanged;
prior runtime export/restore evidence remains applicable, but no live KMS/export/deletion proof
is added. Managed publication, exact key binding and synthetic rights acceptance remain. D1/D3
remain In progress. No AWS mutation, frontend edit, CI/CD or Docker work; PC stays on.


## Current Gateway and candidate rights artifacts

The retained Gateway and rights artifacts were built from older `b5a7a2cf` source. The current
Gateway, rights activity and rights durable artifacts were rebuilt from clean source
`063d4ea9800a761538005aa39407078ef8debd0e` after dependency compilation. Independent verification
checks all twelve publication companions: source/embedded marker, actual ZIP bytes and SHA256,
base64 digest, bundled `index.mjs` hash/equality, SBOM hash/component count and checksum file.
The actual emitted modules import successfully and export their declared handlers. The rights
activity rejects an invalid envelope; terminal/maintenance entrypoints reject missing required
configuration. Gateway native location/protection and rights export configuration markers are
present in the bundles. No valid authenticated invocation, database call or AWS access was used
for this smoke; it is not end-to-end runtime acceptance.

| Artifact | ZIP SHA256 | Bytes | Components |
|---|---|---:|---:|
| gateway-lambda.zip | `8145d593440a76dc636d48083f54f15467c07726f35a6361631fea57b39f90e7` | 1627787 | 157 |
| profile-readiness-activity-lambda.zip | `a7d4c329e59c3ff19ff4da214929ffa72d37297ccf7ca25d01af036dc5f8987c` | 675938 | 109 |
| profile-readiness-durable-lambda.zip | `3fe255dbaaf1e01608702e948357ce97846f01f2a89927ac1dd05f199086074a` | 364076 | 31 |

This is one local packaging pass, not repeated clean reproducibility or a fresh vulnerability
assessment. Existing dependency findings remain unwaived. Local logs/checks are
`.tmp/d3-gateway-rights-build.log`, `.tmp/d3-gateway-rights-integrity.json` and
`.tmp/d3-gateway-rights-smoke.mjs`. Artifacts remain unpublished. Existing preparation and native
control families retain their separately recorded source identities.

The resume control inspection confirms it only attaches scalar ready metadata and preserves
protected fields through the owning store's existing packet-copy path; it does not decrypt or
re-encrypt them. Therefore no additional resume-controller KMS capability was introduced during
this check. Actual managed image/provider/TLS/network/key binding, publication/migrations,
rights/route/recovery acceptance and client/ATS integration remain. D1/D3 remain In progress;
CI/CD deferred, Docker/WSL stopped and PC on.


## Current dependency release check

A fresh `pnpm audit --prod --json` at clean `9ee6f2a8` reports 13 advisory records across
804 production dependencies: one critical, seven high, four moderate and one low. Every returned
finding path was inspected and is frontend-rooted. The raw inventory is:

| Dependency | Advisory records | Reported root |
|---|---:|---|
| shell-quote | 1 critical | frontend/mobile |
| node-forge | 1 high | frontend/mobile |
| braces | 1 high | frontend/mobile |
| image-size | 2 high | frontend/mobile |
| source-map-js | 1 high | frontend/admin |
| sharp | 1 high | frontend/admin |
| next | 6 (1 high, 4 moderate, 1 low) | frontend/admin |

The repository's authoritative `pnpm audit:dependencies` also exits 1. Its exact local image-size
patch validation remains the authority for that already addressed package; raw registry records
alone do not show that patch failing. The other advisories are not waived. No shared lockfile,
frontend dependency or exemption was changed under the backend-only task. This registry snapshot
does not prove absence of backend vulnerabilities or replace independent launch review.

Ignored local records are `.tmp/d3-current-production-audit.json`,
`.tmp/d3-current-production-audit-paths.json` and `.tmp/d3-current-dependency-audit.log`.
Production dependency remediation belongs with the corresponding frontend release work. Backend
managed image/domain/TLS/key inputs and publication/acceptance remain pending. Original terminal
recovery has a manual runbook and private bounded inspection; automatic missed-event reconciliation
remains a separately identified local follow-up. CI/CD remains deferred and no hosted run, cloud
mutation, frontend edit or Docker work occurred. D1/D3 remain In progress; PC on.
