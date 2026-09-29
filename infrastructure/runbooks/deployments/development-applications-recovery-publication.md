# Development Applications Recovery Lambda Publication

This procedure publishes one immutable Applications attempt-recovery Lambda artifact from exact,
merged `main`. Publication does not create or update a Lambda, alias, EventBridge rule, queue,
alarm, Terraform state, or database row.

## Preconditions

- Use Node.js 24, pnpm `10.24.0`, portable Terraform `1.16.2`, and the development IAM Identity
  Center profile in `us-east-2`.
- Require a clean `main` checkout exactly equal to `origin/main`. Pass that full commit as
  `SourceSha`.
- Resolve the exact development account and encrypted state bucket locally. Do not copy either
  identifier into shared evidence.
- Keep `applications_attempt_recovery_enabled=false`. Artifact publication is not activation.

All receipts and logs remain below the ignored
`infrastructure/terraform/environments/development/.terraform/development-applications-recovery-artifacts`
directory.

## Inspect, publish, and verify

```powershell
. ./scripts/use-deployment-terraform.ps1

.\scripts\operate-development-applications-recovery-publication.ps1 -Action Status `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

.\scripts\operate-development-applications-recovery-publication.ps1 -Action Publish `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -SourceSha MERGED_COMMIT

.\scripts\operate-development-applications-recovery-publication.ps1 -Action Verify `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -SourceSha MERGED_COMMIT `
  -ReceiptPath RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256
```

`Publish` runs the workflow tests and dependency audit, builds the exact recovery artifact twice,
and requires byte-for-byte reproducibility. It conditionally writes only the ZIP, manifest,
CycloneDX SBOM, and checksum companion below
`lambda/applications/<source>/<artifact-digest>/`. Existing versions and delete markers at any
destination key fail closed.

`Verify` independently reads the four exact S3 object versions and checks source metadata,
checksums, lengths, version IDs, and the Terraform-owned platform KMS key. Give the resulting
receipt path and SHA-256 to the activation-plan reviewer. Never substitute a different receipt or
object version after plan review.

## Failure and recovery

- A failed publication may leave immutable objects and a receipt in `publishing` state. Do not
  overwrite or delete them. Diagnose the failure and publish a new exact source/digest.
- A failed verification changes no runtime. Do not enable the scheduler from an unverified receipt.
- Activation and rollback use the separate reviewed-plan flow in the
  [Gateway release runbook](development-gateway-release.md#activating-d3-platform-capabilities-d3-001-and-d3-005).
