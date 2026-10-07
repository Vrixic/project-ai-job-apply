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
