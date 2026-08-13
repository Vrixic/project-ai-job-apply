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

`Publish` runs all migration-owner tests and the dependency audit. It performs two no-cache
BuildKit exports with pinned bases, a fixed commit timestamp, attestations and SBOMs explicitly
disabled, explicit OCI source labels, and platform `linux/amd64`. The Dockerfile rewrites each
generated pnpm `prunedAt` field and every `/migration` filesystem mtime to the commit epoch; the
OCI exporter also applies `rewrite-timestamp=true`. Both exports must have identical index,
platform-manifest, configuration, ordered compressed-layer, and ordered rootfs-diff-ID identities.
The second export then passes a networkless, read-only, non-root runtime/module/migration-file smoke
test.

Publication first installs the exact platform manifest under the immutable
`MERGED_SHA-linux-amd64` handoff tag. Only after its manifest bytes, configuration, and compressed
layers read back exactly does the operator install the exported OCI index under the full source SHA
tag. The source tag must resolve to that exact index, containing exactly one `linux/amd64` child and
no attestation descriptors. ECR scanning is polled on the platform digest, never the parent index.
The receipt separately records `indexDigest`, `platformDigest`, `configDigest`, the ordered
compressed-layer fingerprint, and the rootfs diff-ID fingerprint. Its `imageUri` is
`repository@platformDigest`, which is the only value suitable for the migration task.

ECR authentication uses a unique temporary Docker configuration below the ignored operator
directory. The operator removes it after the push so the short-lived registry token is not retained
in the user's normal Docker configuration.

The default receipt path is deterministic for the source commit. If the client is interrupted
after the push, rerunning the same command can finalize only an exact retained `publishing`
version-2 receipt whose boundary, source, index, platform, configuration, and layer fingerprints
match the two rebuilt images. A platform handoff without the source index resumes only after exact
readback. A source index without its handoff, any version-1 receipt, or any pre-existing tag without
the exact version-2 receipt is rejected; immutable tags are never overwritten or deleted.

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

It covers account/repository/KMS substitutions, missing/extra/wrong platforms, index/platform/config/
layer digest confusion, deterministic-build mismatch, wrong handoffs, incomplete or vulnerable
scans, version-1 and unsafe recovery states, receipt path traversal, and the absence of Terraform,
ECS execution, and ECR deletion operations.
