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
