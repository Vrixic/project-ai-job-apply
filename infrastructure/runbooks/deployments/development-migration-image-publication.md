# Development Migration Image Publication

Use this local operator only when the protected `Publish environment images` workflow cannot run
because the repository's GitHub Actions budget is exhausted. It publishes an artifact; it does not
apply Terraform, register a task definition, execute a migration, or change application traffic.

## Boundary

- Work from clean `main` exactly equal to `origin/main`, and pass that 40-character commit as
  `SourceSha`.
- Use Terraform `1.9.8`, Docker Buildx, and temporary IAM Identity Center credentials for the exact
  development account in `us-east-2`.
- Resolve `ai-job-apply/migration` and its customer-managed KMS key from the encrypted development
  Terraform state. The operator cross-checks the live repository ARN, URI, account, immutable-tag
  setting, scan-on-push setting, and KMS key against that state.
- Keep receipts and logs in the ignored
  `infrastructure/terraform/environments/development/.terraform/development-migration-image/`
  directory. They contain environment identifiers and must not be committed or pasted into shared
  evidence.

## Publish and review

First run read-only status:

```powershell
.\scripts\publish-development-migration-image.ps1 -Action Status `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET
```

Then publish the exact merged commit:

```powershell
.\scripts\publish-development-migration-image.ps1 -Action Publish `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -SourceSha MERGED_40_CHARACTER_COMMIT
```

`Publish` runs all migration-owner tests and the dependency audit. It performs two clean BuildKit
builds with pinned bases, a fixed commit timestamp, attestations disabled, explicit OCI source
labels, and platform `linux/amd64`. Both builds must have the same image-configuration digest and
root-filesystem layer identity before the second build receives the exact source tag. The operator pushes only that tag,
reads its immutable registry digest and manifest back, requires the remote configuration digest to
equal the locally inspected image, and waits for an ECR scan status of `COMPLETE` with zero
Critical and High findings.

ECR authentication uses a unique temporary Docker configuration below the ignored operator
directory. The operator removes it after the push so the short-lived registry token is not retained
in the user's normal Docker configuration.

The default receipt path is deterministic for the source commit. If the client is interrupted
after the push, rerunning the same command can finalize only an exact retained `publishing`
receipt whose boundary, source, configuration digest, and layer fingerprint match the two rebuilt
images. A pre-existing tag without that exact receipt is rejected; immutable tags are never
overwritten or deleted.

Have an independent reviewer inspect the sanitized result and the ignored receipt, record its
SHA-256 out of band, and run:

```powershell
.\scripts\publish-development-migration-image.ps1 -Action Verify `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -SourceSha MERGED_40_CHARACTER_COMMIT `
  -ReceiptPath .terraform/development-migration-image/receipt-MERGED_SHA_PREFIX.json `
  -ReviewedReceiptSha256 REVIEWED_64_CHARACTER_SHA256
```

`Verify` rehashes the exact receipt, revalidates its environment and source bindings, resolves the
exact digest and manifest again, and repeats the completed zero-High/zero-Critical scan check. Pass
only the verified digest URI to the separately reviewed migration task-definition plan. Do not use
the source tag in Terraform and do not run a migration merely because publication succeeded.

## Local source verification

The guard suite is pure and makes no AWS or Docker calls:

```powershell
powershell.exe -NoProfile -File scripts/tests/development-migration-image-publisher.tests.ps1
pwsh -NoProfile -File scripts/tests/development-migration-image-publisher.tests.ps1
```

It covers account/repository/KMS substitutions, source/platform/label substitutions, remote digest
binding, incomplete or vulnerable scans, receipt path traversal, and the absence of Terraform,
ECS execution, and ECR deletion operations.
