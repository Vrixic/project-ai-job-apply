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
| `CompleteDark` | Coordinator, disabled mapping and reconciler target, STS endpoint, and exact existing endpoint grants | Seven creates and three policy updates |

The operator rejects skipped or reversed stages. `CompleteDark` reads the numeric parser version
ARN from applied `ParserDark` state, verifies its exact account, region, function name, and positive
version, then binds that ARN into the processor policy, environment, and Lambda endpoint policy.
It never predicts a Lambda version or invokes `$LATEST`.

## Required reviewed inputs

- clean `main` exactly matching `origin/main`;
- the development IAM Identity Center caller in the exact account and `us-east-2`;
- the private, versioned, customer-KMS Terraform state bucket;
- a checksum-reviewed Terraform `1.9.8` zero-change baseline;
- for parser and complete stages, the checksum-reviewed verified document publication receipt.

The historical intake-only baseline is accepted only as an input reconstruction boundary. The
operator maps its retired deployment and KMS booleans to `kms-prerequisite`; current Terraform
source contains only the stage enum and parser-version pin.

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
