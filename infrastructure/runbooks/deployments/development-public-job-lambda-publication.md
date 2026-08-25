# Development Public-Job Lambda Publication

Use this guarded local publisher when GitHub Actions are excluded and the separate anonymous edge
and private projection artifacts must be published from exact merged `main`. Publication is
development-only and does not deploy a Lambda, move an alias, enable the API route, change crawler
policy, apply Terraform, or run a migration.

## Preconditions

- Use Node.js 24, pnpm `10.24.0`, and the approved development IAM Identity Center profile in
  `us-east-2`; never use the default long-lived IAM user.
- Require a clean checkout with `main == origin/main`, and pass that exact 40-character commit as
  `SourceSha`.
- Resolve the development account and encrypted Terraform state bucket locally. Do not place
  account, bucket, KMS, token, or credential values in repository evidence.
- Keep `public_job_route_activation_allowed=false` and web indexing disabled. Publication is not
  source-quality, crawlability, security/privacy, accessibility, or product approval.

## Publish and verify

```powershell
.\scripts\operate-development-public-job-lambda-publication.ps1 -Action Publish `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT
```

The operator runs gateway tests and the dependency audit, builds the artifacts twice, verifies the
anonymous edge contains no database runtime markers, and requires byte-for-byte reproducibility.
It conditionally publishes exactly eight new versioned customer-KMS objects: ZIP, CycloneDX SBOM,
manifest, and checksum for `public-job-edge-lambda` and `public-job-projection-lambda`. Any existing
object version or delete marker at an intended key fails closed. The sanitized receipt stays under
the ignored development `.terraform/development-public-job-artifacts` directory.

Independently review the printed receipt checksum, then run:

```powershell
.\scripts\operate-development-public-job-lambda-publication.ps1 -Action Verify `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
  -ReceiptPath RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256
```

Verification reads every exact object version and checks its checksum, customer KMS key, Bucket
Key, metadata, length, source, artifact digest, manifest, SBOM, and checksum companion. Use only the
verified ZIP coordinates in a separately saved and reviewed Terraform plan.

## Failure handling

Never overwrite or delete a partially published immutable key. Preserve its receipt/log context,
correct the source, and publish a new exact commit/digest. A failed publication or verification is
not authorization to deploy, enable the anonymous route, or turn on indexing.
