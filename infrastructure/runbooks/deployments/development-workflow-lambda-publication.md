# Development Workflow Lambda Publication

Use `scripts/operate-development-workflow-lambda-publication.ps1` when the protected publisher is
unavailable and an exact development release needs current workflow ingress/profile-readiness
artifacts. This procedure publishes immutable release evidence only. It never updates a Lambda
function or alias, enables a trigger, applies Terraform, executes a migration, or authorizes a
candidate-rights policy.

## Boundary

- Target only the dedicated development account in `us-east-2` through temporary IAM Identity
  Center credentials.
- Require a clean `main` checkout exactly equal to `origin/main`; pass that exact 40-character
  commit as `SourceSha`.
- Supply the encrypted development Terraform state bucket out of band. The operator resolves the
  artifact bucket and platform KMS key from current Terraform state, so the caller cannot choose a
  substitute publication destination.
- Publish exactly these three artifact sets: `workflow-ingress-lambda`,
  `profile-readiness-durable-lambda`, and `profile-readiness-activity-lambda`. Ingestion artifacts
  are outside this operator even though the package build also verifies them.
- Keep receipts and logs under
  `infrastructure/terraform/environments/development/.terraform/development-workflow-artifacts/`.
  They are ignored operational material and must not be copied wholesale into shared evidence.

## Status

Run the read-only boundary check first:

```powershell
.\scripts\operate-development-workflow-lambda-publication.ps1 -Action Status `
  -ExpectedAccountId '<development-account-id>' `
  -StateBucket '<development-terraform-state-bucket>'
```

It requires the exact account/Region, an assumed-role caller, Terraform `1.16.2`, Node.js 24, pnpm
`10.24.0`, clean current source, an exact customer-KMS-encrypted/versioned state object, and the
Terraform-owned artifact bucket/KMS boundary. It writes no object.

## Publish

```powershell
$sourceSha = (git rev-parse HEAD).Trim()
.\scripts\operate-development-workflow-lambda-publication.ps1 -Action Publish `
  -ExpectedAccountId '<development-account-id>' `
  -StateBucket '<development-terraform-state-bucket>' `
  -SourceSha $sourceSha
```

Publication:

1. runs the workflow unit suite and centralized dependency audit;
2. builds the exact source twice and requires byte-identical ZIP, schema-2 manifest, CycloneDX 1.6
   SBOM, and checksum companion identities for all three selected artifacts;
3. derives twelve digest-addressed keys below
   `lambda/workflows/<source-sha>/<artifact-sha256>/`;
4. rejects any existing version or delete marker for every exact key before the first write;
5. uses conditional `If-None-Match: *` puts with full-object SHA-256 plus source/artifact metadata;
6. reads every returned version back and verifies the exact Terraform KMS key, S3 Bucket Key,
   checksum, metadata, length, and version; and
7. writes a sanitized schema-1 receipt and prints only its local path/checksum and aggregate counts.

If a put succeeds and a later step fails, retain the `publishing` receipt. Never delete, overwrite,
or blindly retry one of its keys; inspect the partial immutable publication and make a bounded
recovery decision.

## Verify and handoff

```powershell
.\scripts\operate-development-workflow-lambda-publication.ps1 -Action Verify `
  -ExpectedAccountId '<development-account-id>' `
  -StateBucket '<development-terraform-state-bucket>' `
  -SourceSha $sourceSha `
  -ReceiptPath '.terraform\development-workflow-artifacts\receipt-....json' `
  -ReviewedReceiptSha256 '<lowercase-receipt-sha256>'
```

Verification recomputes the live environment binding and repeats exact-version readback for all
twelve objects. A later reviewed Terraform plan may consume only the three ZIP entries' `key`,
`versionId`, `artifactSha256`, and `objectBase64Sha256`. Publication alone is not deployment,
candidate-rights activation, managed-identity configuration, or runtime acceptance.
