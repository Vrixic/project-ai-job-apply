# Development Ingestion Lambda Publication

Use `scripts/operate-development-ingestion-lambda-publication.ps1` when GitHub Actions are excluded
and the exact ingestion durable and runtime artifacts must be published from merged `main`.
Publication is development-only. It does not deploy a Lambda, move an alias, enable a scheduler or
queue mapping, activate a source, add provider egress, apply Terraform, or run a migration.

## Preconditions

- Use Node.js 24, pnpm `10.24.0`, and an approved temporary development IAM Identity Center session
  in `us-east-2`.
- Require a clean checkout with `main == origin/main`, and pass that exact lowercase 40-character
  commit as `SourceSha`.
- Resolve the development account and encrypted Terraform state bucket locally. Do not place
  account, bucket, KMS, credential, object-version, or raw receipt values in shared evidence.
- Keep ingestion runtime, generated-synthetic source, provider activation, provider private egress,
  and every configured provider source disabled. Publication grants no activation authority.

Run the read-only boundary check first:

```powershell
.\scripts\operate-development-ingestion-lambda-publication.ps1 -Action Status `
  -ExpectedAccountId 'DEVELOPMENT_ACCOUNT_ID' `
  -StateBucket 'DEVELOPMENT_TERRAFORM_STATE_BUCKET'
```

## Publish

```powershell
$sourceSha = (git rev-parse HEAD).Trim()
.\scripts\operate-development-ingestion-lambda-publication.ps1 -Action Publish `
  -ExpectedAccountId 'DEVELOPMENT_ACCOUNT_ID' `
  -StateBucket 'DEVELOPMENT_TERRAFORM_STATE_BUCKET' `
  -SourceSha $sourceSha
```

The operator runs the workflow tests and centralized dependency audit, builds the ingestion
artifacts twice, and requires byte-identical ZIP, schema-2 manifest, CycloneDX 1.6 SBOM, and
checksum companion identities. It publishes exactly eight objects below
`lambda/ingestion/<source-sha>/<artifact-sha256>/`: four for `ingestion-durable-lambda` and four for
`ingestion-runtime-lambda`.

Before the first write, every exact key must have no existing object version or delete marker. Each
write uses `If-None-Match: *`, full-object SHA-256, and source/artifact metadata. Exact-version
readback must match the Terraform-owned customer KMS key, S3 Bucket Key, checksum, metadata,
length, and version. The sanitized receipt and command logs remain under the ignored
`.terraform/development-ingestion-artifacts` directory.

If a write succeeds and a later step fails, retain the `publishing` receipt. Never overwrite,
delete, or blindly retry any partially published immutable key. Correct source must be released as
a new exact commit/digest.

## Verify and hand off

Independently review the printed receipt checksum, then run:

```powershell
.\scripts\operate-development-ingestion-lambda-publication.ps1 -Action Verify `
  -ExpectedAccountId 'DEVELOPMENT_ACCOUNT_ID' `
  -StateBucket 'DEVELOPMENT_TERRAFORM_STATE_BUCKET' `
  -SourceSha $sourceSha `
  -ReceiptPath '.terraform\development-ingestion-artifacts\receipt-....json' `
  -ReviewedReceiptSha256 'LOWERCASE_RECEIPT_SHA256'
```

Verification repeats exact-version readback for all eight objects. A separate checksum-reviewed
Terraform release may consume only each verified ZIP entry's key, object version, artifact SHA-256,
and Lambda-compatible base64 SHA-256. Publication alone is not deployment, provider approval,
source activation, network acceptance, or representative runtime evidence.
