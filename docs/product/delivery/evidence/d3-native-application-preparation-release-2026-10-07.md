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
