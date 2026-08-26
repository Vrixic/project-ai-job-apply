# Development document-processing staged dark deployment

This operator advances the document runtime through one monotonic stage at a time. It never uses
Terraform `-target`, and it never enables the scan-result mapping, scan-result rule, or reconciler.
Parser and complete stages deliberately enable only the two bounded GuardDuty protection-health
alert rules after their referenced protection plan and candidate-document bucket exist.

## Stages

| Stage | Applied boundary | Exact reviewed action set |
|---|---|---|
| `KmsPrerequisite` | Two exact EventBridge grants on the platform KMS key | One in-place update when first installed; zero drift thereafter |
| `ParserDark` | Encrypted queues, dark processing rules, active bounded security-health alerts, bounded roles, isolated parser, S3 endpoint, metrics and alarms | 32 creates and two policy updates |
| `CompleteDark` | Coordinator, disabled mapping and reconciler target, STS endpoint, and exact existing endpoint grants | Seven creates and three policy updates; later artifact refreshes use two reviewed parser updates followed by three reviewed processor/policy updates |

The operator rejects skipped or reversed stages. `CompleteDark` reads the numeric parser version
ARN from applied `ParserDark` state, verifies its exact account, region, function name, and positive
version, then binds that ARN into the processor policy, environment, and Lambda endpoint policy.
It never predicts a Lambda version or invokes `$LATEST`.

When the accepted ParserDark baseline belongs to an ancestor document release, CompleteDark uses
an explicit source transition. The processor remains pinned to the already-applied numeric parser
version proven by that baseline. In the same reviewed plan, the parser function and development
alias move to the separately published exact-current parser artifact while the normal seven
CompleteDark resources and three endpoint-policy grants are added. Apply and live verification
prove that both the retained pinned version and the new alias artifact exist with their exact
checksums. The old pin is intentional: it avoids predicting the new Lambda version during plan,
and it remains immutable for direct dark conformance.

## Required reviewed inputs

- clean `main` exactly matching `origin/main`;
- the development IAM Identity Center caller in the exact account and `us-east-2`;
- the private, versioned, customer-KMS Terraform state bucket;
- a checksum-reviewed Terraform `1.9.8` zero-change baseline;
- for parser and complete stages, the checksum-reviewed verified document publication receipt.

If the retained schema-3/4 ParserDark baseline's operator revision is an ancestor of current
`main`, also require the independently reviewed canonical delta from that baseline operator to
current `main`. Omit it when both revisions are exact. Only modified regular blobs on the existing
deployment-operator/test/runbook allowlist are accepted.

The historical intake-only baseline is accepted only as an input reconstruction boundary. The
operator maps its retired deployment and KMS booleans to `kms-prerequisite`; current Terraform
source contains only the stage enum and parser-version pin.

An already-applied `ParserDark` release may also use that exact checksum-reviewed historical
52/53-variable KMS baseline for `Verify` recovery only. The exception requires the requested and
live stages both to be `parser-dark`; it is unavailable to `Plan`, `Apply`, `CompleteDark`, or any
different live stage. Receipt, release/source delta, state, KMS, live isolation, and zero-drift
checks remain unchanged, and failed retained-baseline creation removes its new plan and sidecar.

## Plan, apply, and verify

`KmsPrerequisite` represents the already-applied, checksum-reviewed development boundary and can
be checked with `-Action Verify -Stage KmsPrerequisite` without publication-receipt arguments. Its
historical one-update plan is retained in the semantic guard; development's next transition is
`ParserDark`.

Use the same command shape for `ParserDark` and then `CompleteDark`:

```powershell
.\scripts\operate-development-document-dark-deployment.ps1 -Action Plan -Stage ParserDark `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -BaselinePlanPath ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
  [-ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256] `
  -PublicationReceiptPath VERIFIED_RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256
```

Review the exact saved bytes and checksum, then apply them:

```powershell
.\scripts\operate-development-document-dark-deployment.ps1 -Action Apply -Stage ParserDark `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -BaselinePlanPath ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
  [-ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256] `
  -PublicationReceiptPath VERIFIED_RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256 `
  -PlanPath PLAN_PATH_FROM_PLAN -ReviewedPlanSha256 PLAN_SHA256
```

Verify the applied stage without changing AWS:

```powershell
.\scripts\operate-development-document-dark-deployment.ps1 -Action Verify -Stage ParserDark `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -ReleaseSourceSha DEPLOYED_DOCUMENT_ARTIFACT_COMMIT `
  -ReviewedOperatorDeltaSha256 REVIEWED_CANONICAL_OPERATOR_DELTA_SHA256 `
  -BaselinePlanPath ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
  [-ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256] `
  -PublicationReceiptPath VERIFIED_RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256
```

Successful verification retains the exact refresh-backed zero-change plan under the ignored
`development/.terraform/development-document-dark-deployment` directory instead of deleting it.
The printed `BaselinePath`, `BaselineSha256`, `BaselineMetadataPath`, and
`BaselineMetadataSha256` bind the plan and adjacent `.baseline.json` sidecar to the exact account,
region, merged source, state lineage and serial, stage, publication receipt, and parser-version pin.
The plan is independently re-read and accepted only when Terraform 1.9.8
reports it complete, nonerrored, nonapplyable, and free of meaningful resource or output changes;
only the already bounded provider refresh records may remain. The operator never overwrites a
plan or sidecar.

When the deployed immutable document artifacts belong to an ancestor of the current operator,
only `Verify` may use that release. The operator proves Git ancestry, accepts only modified regular
blobs on the explicit deployment-operator/test/runbook allowlist, rejects binary, renamed, added,
deleted, submodule, Terraform, product, and artifact changes, and recomputes the reviewed SHA-256
over the exact name-status records and full-index patch. The retained schema-3 sidecar records the
release SHA, current operator SHA, and canonical delta SHA-256. Migration and gateway consumers
independently recompute that evidence before accepting it. Omit the delta argument only when the
release and operator commits are identical.

`Plan` and `Apply` reject ancestor releases and retain the existing exact-current schema-2 plan
metadata. A `CompleteDark` source transition therefore requires current-source document artifacts
to be separately published and reviewed. It never reuses the Verify-only ancestor artifact
exception. The retained ParserDark plan and sidecar remain separate inputs: their plan, metadata,
release/operator/delta, old receipt, state lineage/serial, parser artifact, and live numeric version
are revalidated before planning and applying the exact-current release.

For that transition, add the baseline-to-current delta only when the retained sidecar's
`OperatorSourceSha` is older than current `main`:

```powershell
.\scripts\operate-development-document-dark-deployment.ps1 -Action Plan -Stage CompleteDark `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -BaselinePlanPath PARSER_DARK_BASELINE -ReviewedBaselineSha256 BASELINE_SHA256 `
  -ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256 `
  [-ReviewedBaselineToOperatorDeltaSha256 REVIEWED_BASELINE_OPERATOR_DELTA_SHA256] `
  -PublicationReceiptPath EXACT_CURRENT_RECEIPT -ReviewedReceiptSha256 CURRENT_RECEIPT_SHA256
```

The accepted transition plan has exactly seven creates and five in-place updates: the normal
three endpoint-policy updates plus the parser function and parser alias. Any replacement, delete,
additional resource/output, protected runtime-field change, unexpected unknown, sensitivity
broadening, trigger activation, receipt mismatch, version-pin mismatch, or state change is a hard
failure. Apply uses the same optional baseline-to-current delta argument and the exact reviewed
plan checksum. A successful `CompleteDark` apply retains and prints a new checksum-bound
zero-drift baseline and metadata sidecar. That handoff binds the current parser and processor
artifacts while preserving the exact older numeric parser-version ARN used by the dark processor;
later `CompleteDark` verification proves that pinned immutable version remains healthy, the
current parser alias still matches the current receipt, and no processing trigger is active.

### Refresh an already CompleteDark runtime

If the latest document baseline is historical while live Terraform state has advanced through
other guarded releases, first create current-state document evidence with the read-only bootstrap.
The bootstrap accepts the reviewed schema-3/4 document baseline or schema-5 migration handoff at
its recorded serial. It also requires a separately reviewed zero-drift plan at the exact current
state and its verification receipt as the variable template. The template source must be the
current operator or its Git ancestor; the exact checksum, state lineage/serial, default-dark
verification, and a new current-source refresh plan—not source equality alone—prove that its
variables are current. Only the historical document artifact coordinates, numeric parser pin,
stage, and dark switches replace template values.

Produce the template with `scripts/operate-development-ingestion-dark-release.ps1 -Action Verify`.
Use that operator's retained `ZeroDriftPlanPath` and `VerificationPath`; bootstrap accepts only the
exact schema-1 `development-ingestion-dark-release-verification` receipt and its checksum-reviewed
zero-drift plan at the current state serial.

```powershell
.\scripts\operate-development-document-dark-deployment.ps1 -Action Bootstrap -Stage CompleteDark `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -ReleaseSourceSha HISTORICAL_DOCUMENT_RELEASE_SHA `
  -ReviewedOperatorDeltaSha256 REVIEWED_RELEASE_TO_CURRENT_BOOTSTRAP_DELTA `
  -ReviewedBaselineToOperatorDeltaSha256 REVIEWED_BASELINE_OPERATOR_TO_CURRENT_BOOTSTRAP_DELTA `
  -BaselinePlanPath HISTORICAL_COMPLETE_DARK_BASELINE `
  -ReviewedBaselineSha256 HISTORICAL_BASELINE_SHA256 `
  -ReviewedBaselineMetadataSha256 HISTORICAL_BASELINE_METADATA_SHA256 `
  -PublicationReceiptPath HISTORICAL_DOCUMENT_RECEIPT `
  -ReviewedReceiptSha256 HISTORICAL_DOCUMENT_RECEIPT_SHA256 `
  -CurrentTemplatePlanPath REVIEWED_CURRENT_ZERO_DRIFT_PLAN `
  -ReviewedCurrentTemplateSha256 CURRENT_TEMPLATE_PLAN_SHA256 `
  -CurrentTemplateReceiptPath REVIEWED_CURRENT_VERIFICATION_RECEIPT `
  -ReviewedCurrentTemplateReceiptSha256 CURRENT_TEMPLATE_RECEIPT_SHA256
```

Both reviewed deltas use the domain-separated
`development-document-complete-dark-bootstrap-delta-v1` canonical full-source contract. Bootstrap
never calls `terraform apply`: it proves clean current main, exact historical receipt versions and
KMS boundary, the complete live parser/processor/IAM/queue/rule/endpoint dark boundary, same state
lineage with a strictly newer live serial, and a full untargeted refresh-backed zero-change plan.
State identity must remain stable while evidence is written. Success emits an exclusive schema-6
baseline sidecar binding the historical schema and serial, both reviewed bootstrap deltas, current
operator, current state, receipt, parser pin, migration image, and new plan checksum. Use that plan
and sidecar as `CURRENT_COMPLETE_DARK_BASELINE` below. A parser refresh accepts schema 6 only at its
exact current serial and repeats the complete live-boundary proof before planning.

Do not predict the next parser version or combine the release into one plan. The processor policy
and environment both require the exact numeric parser ARN, which exists only after parser apply.
Keep the mapping, scan-result rule, and reconciler rule disabled throughout these two reviewed steps.

```powershell
.\scripts\operate-development-document-dark-deployment.ps1 -Action Plan -Stage CompleteDark `
  -RefreshStep Parser -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -BaselinePlanPath CURRENT_COMPLETE_DARK_BASELINE -ReviewedBaselineSha256 BASELINE_SHA256 `
  -ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256 `
  [-ReviewedBaselineToOperatorDeltaSha256 REVIEWED_BASELINE_OPERATOR_DELTA_SHA256] `
  -PublicationReceiptPath EXACT_CURRENT_RECEIPT -ReviewedReceiptSha256 CURRENT_RECEIPT_SHA256

.\scripts\operate-development-document-dark-deployment.ps1 -Action Apply -Stage CompleteDark `
  -RefreshStep Parser -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -BaselinePlanPath CURRENT_COMPLETE_DARK_BASELINE -ReviewedBaselineSha256 BASELINE_SHA256 `
  -ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256 `
  [-ReviewedBaselineToOperatorDeltaSha256 REVIEWED_BASELINE_OPERATOR_DELTA_SHA256] `
  -PublicationReceiptPath EXACT_CURRENT_RECEIPT -ReviewedReceiptSha256 CURRENT_RECEIPT_SHA256 `
  -PlanPath REVIEWED_PARSER_PLAN -ReviewedPlanSha256 PARSER_PLAN_SHA256
```

The first plan accepts only parser function and alias updates. Apply observes the new positive
numeric version, verifies the state lineage advanced monotonically and binds its exact resulting
serial, verifies the mixed state with the old processor still pinned, runs a refresh-backed
zero-drift check, and emits an exclusive aggregate parser-refresh receipt under ignored `.terraform`.
Independently review that receipt checksum before step two.

```powershell
.\scripts\operate-development-document-dark-deployment.ps1 -Action Plan -Stage CompleteDark `
  -RefreshStep Processor -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -BaselinePlanPath CURRENT_COMPLETE_DARK_BASELINE -ReviewedBaselineSha256 BASELINE_SHA256 `
  -ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256 `
  [-ReviewedBaselineToOperatorDeltaSha256 REVIEWED_BASELINE_OPERATOR_DELTA_SHA256] `
  -PublicationReceiptPath EXACT_CURRENT_RECEIPT -ReviewedReceiptSha256 CURRENT_RECEIPT_SHA256 `
  -ParserRefreshReceiptPath PARSER_REFRESH_RECEIPT `
  -ReviewedParserRefreshReceiptSha256 PARSER_REFRESH_RECEIPT_SHA256

.\scripts\operate-development-document-dark-deployment.ps1 -Action Apply -Stage CompleteDark `
  -RefreshStep Processor -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -BaselinePlanPath CURRENT_COMPLETE_DARK_BASELINE -ReviewedBaselineSha256 BASELINE_SHA256 `
  -ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256 `
  [-ReviewedBaselineToOperatorDeltaSha256 REVIEWED_BASELINE_OPERATOR_DELTA_SHA256] `
  -PublicationReceiptPath EXACT_CURRENT_RECEIPT -ReviewedReceiptSha256 CURRENT_RECEIPT_SHA256 `
  -ParserRefreshReceiptPath PARSER_REFRESH_RECEIPT `
  -ReviewedParserRefreshReceiptSha256 PARSER_REFRESH_RECEIPT_SHA256 `
  -PlanPath REVIEWED_PROCESSOR_PLAN -ReviewedPlanSha256 PROCESSOR_PLAN_SHA256
```

The second plan accepts exactly the processor IAM policy, function, and alias updates. Both policy
and environment must move from the old numeric parser ARN to the exact ARN in the reviewed parser
receipt. State lineage/serial must match that receipt, outputs must remain known no-ops, and no
trigger may activate. Successful apply performs full live verification and retains the fresh
ordinary CompleteDark zero-drift baseline and checksum-bound sidecar.

If the exact `a6d0fba09082b8bc61ee7b604ee1d5c47bd71624` CompleteDark apply completed but its
post-apply inventory verification stopped before retaining a baseline, recover with `Verify` only.
The recovery accepts only the checksum-reviewed schema-3/4 ParserDark baseline whose stored
release/operator chain is `d0e55de86edfa6b5f655f5631bb1741d6c5b5ac8` to
`cd8bc47fd89239c5e224ccdd1baff097d13c5bf7`, state lineage
`472ef790-b249-45ec-817f-718005980d9e`, and serial `103`; live CompleteDark state must be the same
lineage at serial `106`. Supply both independently reviewed deltas: deployed release `a6d0fba` to
current operator, and retained-baseline operator `cd8bc47` to current operator. The sidecar's
stored `d0e55de` to `cd8bc47` delta remains independently recomputed. Plan, Apply, ParserDark,
different state serials, or any other historical baseline cannot use this exception.

```powershell
.\scripts\operate-development-document-dark-deployment.ps1 -Action Verify -Stage CompleteDark `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -ReleaseSourceSha a6d0fba09082b8bc61ee7b604ee1d5c47bd71624 `
  -ReviewedOperatorDeltaSha256 REVIEWED_A6_TO_CURRENT_OPERATOR_DELTA `
  -ReviewedBaselineToOperatorDeltaSha256 REVIEWED_CD8_TO_CURRENT_OPERATOR_DELTA `
  -BaselinePlanPath RETAINED_PARSER_DARK_BASELINE -ReviewedBaselineSha256 BASELINE_SHA256 `
  -ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256 `
  -PublicationReceiptPath DEPLOYED_A6_RECEIPT -ReviewedReceiptSha256 CURRENT_RECEIPT_SHA256
```

Recovery derives the exact old numeric parser-version pin from the applied processor state, proves
that immutable version still matches the retained ParserDark artifact, revalidates the current
parser and processor artifacts from the deployed receipt, and keeps every processing trigger
disabled. Success emits a normal current CompleteDark schema-3 zero-drift baseline at serial
`106`, binding release `a6d0fba`, the current operator and release-to-operator delta, the current
receipt, and the recovered old parser-version pin. Failed retention removes both new artifacts.

If the reviewed `b4bfb38ddb8740a9c9fb8528a7e733e32f184c01` gateway plan applied at document
baseline serial `106`, advancing the same lineage to `107`, but its post-apply search check stopped
before zero drift, use the separate already-applied-gateway recovery form. This is available only
to `Verify` at requested and live `CompleteDark`. Its seven recovery inputs are all-or-none;
`Plan`, `Apply`, other stages, other serials, other paths, and partial input sets are rejected.

```powershell
.\scripts\operate-development-document-dark-deployment.ps1 -Action Verify -Stage CompleteDark `
  -ExpectedAccountId 362544434697 `
  -StateBucket ai-job-apply-development-terraform-state-362544434697 `
  -ReleaseSourceSha a6d0fba09082b8bc61ee7b604ee1d5c47bd71624 `
  -ReviewedOperatorDeltaSha256 REVIEWED_A6_TO_CURRENT_OPERATOR_DELTA `
  -ReviewedBaselineToOperatorDeltaSha256 REVIEWED_B4B_TO_CURRENT_OPERATOR_DELTA `
  -BaselinePlanPath RETAINED_B4B_COMPLETE_DARK_BASELINE `
  -ReviewedBaselineSha256 6a6b281497f5f629e0ae1dc54052e2b0975d354ffc9aaa1d6f980368459e9d2b `
  -ReviewedBaselineMetadataSha256 b219a07674552bed93ae492b3e96cdf8da0ebae1e1b1003830673adeec8daea1 `
  -PublicationReceiptPath DEPLOYED_A6_DOCUMENT_RECEIPT `
  -ReviewedReceiptSha256 524bbf645621a0aa744c3e84f7deff5f8430830e87330267ed5ca7243f40023e `
  -RetainedParserReceiptPath RETAINED_D0E_PARSER_DARK_RECEIPT `
  -ReviewedRetainedParserReceiptSha256 97d4084d0a5b2ddfc563f3e4f76bafb9598dcdd0e9579fb18821b6bdc9097677 `
  -AppliedGatewayPlanPath EXACT_B4B_APPLIED_GATEWAY_PLAN `
  -ReviewedAppliedGatewayPlanSha256 1d41366e7f40d51c09000d823f1c0b104c82deee5f177e2a782e5a92641c5fab `
  -ReviewedAppliedGatewayPlanMetadataSha256 6a46db5c0f5cb4aadfe97542c0333733dcb0e35f9578a4da9b704ef428d3d837 `
  -AppliedGatewayReceiptPath EXACT_B4B_GATEWAY_RECEIPT `
  -ReviewedAppliedGatewayReceiptSha256 2ea5d284126fc25bc4532059f7780a92669670927391ada50c2f70d53d0f8d41
```

The operator independently rehashes the exact plan, adjacent `.gateway-release.json`, current
receipt, and retained ParserDark receipt; revalidates the original CompleteDark baseline and its
`a6d0fba` to `b4bfb38` source binding; requires separately reviewed `a6d0fba` and `b4bfb38`
deltas to current `main`; and accepts only modified regular, nonbinary blobs on the explicit
recovery allowlist. The only product paths on that allowlist are the timestamp normalization
implementation and test. The retained receipt must be the exact checksum-reviewed `d0e55de`
publication and all eight immutable objects must pass exact-version S3 checksum, KMS, and metadata
readback. Its parser ZIP proves the intentionally retained parser-v1 bytes; the current `a6d0fba`
receipt and applied plan continue to describe the latest parser-v2 artifact and current
CompleteDark variables. It then reuses the strict gateway guards to prove the plan contains exactly
the gateway function and alias updates, with no replacement, additional output, unknown-field,
sensitivity, drift, parser-pin, document, migration-image, or artifact broadening. Current
Terraform state and the live unrouted numeric alias must match the applied artifact.

The applied plan is never applied again. Its planned variables are used only as the reconstructed
serial-107 input template, because the serial-106 document baseline predates the gateway update.
After the full live CompleteDark boundary passes, a refresh-backed Terraform 1.9.8 zero-change
plan is retained with a current-source serial-107 sidecar. Any failure removes newly created
baseline artifacts and does not weaken the older ParserDark recovery path.

The optional metadata argument is omitted only for the checksum-reviewed historical intake
baseline used by the initial `KmsPrerequisite` to `ParserDark` transition. Every current-shape
retained baseline requires `ReviewedBaselineMetadataSha256`; the operator hashes the adjacent
sidecar before parsing it and then revalidates its exact source, state, stage, receipt, parser pin,
plan, and schema-v2 migration-image bindings.

Use that exact verified baseline for the next guarded migration task release:

```powershell
.\scripts\operate-development-document-migration.ps1 -Action PlanTask `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -SourceSha MERGED_40_CHARACTER_COMMIT -MigrationImage EXACT_ECR_URI_AT_SHA256 `
  -AppliedPlanPath BASELINE_PATH_FROM_VERIFY -AppliedPlanSha256 BASELINE_SHA256_FROM_VERIFY `
  -AppliedPlanMetadataSha256 BASELINE_METADATA_SHA256_FROM_VERIFY
```

Do not substitute the applied ParserDark change plan: the migration operator correctly requires a
zero-change applied-state baseline.

Every saved plan metadata record binds the stage, account, region, state bucket/key,
lineage/serial, merged commit, baseline checksum, publication receipt checksum, parser-version pin,
plan path, and plan checksum. Apply refuses changed state or source and re-runs the exact semantic
plan guard before consuming the reviewed bytes.

## Fail-closed invariants

- no deferred data reads;
- no unknown or sensitive trust, identity policy, endpoint policy, queue policy, attachment role,
  or queue URL;
- no deletes, replacements, extra actions, or cross-stage resources;
- deterministic exact role, queue, rule, function, alias, ARN, and queue-URL bindings;
- scan-result and reconciler rules `DISABLED`, SQS mapping absent or disabled, and only the two
  GuardDuty protection-health alert rules `ENABLED`;
- parser-dark proves the coordinator Lambda, alias, policy, mapping, STS endpoint, reconciler
  target/permission, and later-stage endpoint grants do not exist;
- parser Lambda has no function- or alias-level resource policy in either stage; complete-dark's
  processor alias has exactly one reconciler permission with the exact action, service principal,
  source rule, qualified alias resource, and statement ID;
- any Terraform state address in the document-owned resource namespace outside the exact stage
  allowlist is rejected, including shadow roles, queues, rules, targets, alarms, filters, aliases,
  permissions, mappings, endpoints, or security groups;
- complete-dark rechecks exact live Lambda, role/trust/policy, security-group, queue, target, alarm,
  and endpoint boundaries;
- immutable artifact and live alias hashes match the reviewed receipt;
- refresh-backed zero drift after each apply.

Trigger activation is a later, separately reviewed rollout after synthetic dark conformance.
