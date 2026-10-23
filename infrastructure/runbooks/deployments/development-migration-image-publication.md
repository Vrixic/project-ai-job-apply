# Development Migration Image Publication

Use this local operator only when the protected `Publish environment images` workflow cannot run
because the repository's GitHub Actions budget is exhausted. It publishes an artifact; it does not
apply Terraform, register a task definition, execute a migration, or change application traffic.

## Boundary

- Work from clean `main` exactly equal to `origin/main`. LocalBuild and Publish require that exact
  40-character commit as `SourceSha`. Read-only Verify also accepts an exact ancestor merged into
  current main, so later evidence commits do not require rebuilding an already published image.
- Use Terraform `1.16.2`, Docker Buildx, and temporary IAM Identity Center credentials for the exact
  development account in `us-east-2`.
- Resolve `ai-job-apply/migration` and its customer-managed KMS key from the encrypted development
  Terraform state. The operator cross-checks the live repository ARN, URI, account, immutable-tag
  setting, scan-on-push setting, and KMS key against that state.
- Keep receipts and logs in the ignored
  `infrastructure/terraform/environments/development/.terraform/development-migration-image/`
  directory. They contain environment identifiers and must not be committed or pasted into shared
  evidence.

## Publish and review

When AWS or protected GitHub runners are unavailable, the exact merged source can still complete
the non-publishing gate without cloud credentials:

```powershell
.\scripts\publish-development-migration-image.ps1 -Action LocalBuild `
  -SourceSha MERGED_40_CHARACTER_COMMIT
```

`LocalBuild` requires clean `main` exactly equal to `origin/main`. From a fresh dependency install,
it generates the executable contracts and runs the same migration-owner tests, dependency audit,
two deterministic OCI exports, byte-identity comparison, and hardened runtime smoke used by
`Publish`, then records only ignored local logs/layouts. It does not contact AWS, run a
vulnerability scan, publish an image, or satisfy the publication/scan/recovery gate.

The current package boundary is the Phase 3 manifest
`d3-application-lifecycle-profile-jobs-documents-matching-billing-trust-applications-v1`: eight ordered owners
(Profile, Jobs, Documents, Matching, Billing, Trust, Applications, and Notifications), thirteen schemas, 105 regular relations, and
87 exact checksum-bound migrations. The smoke gate also requires the Trust, Applications, and Notifications runners and every
Phase 2/3 migration file, including Jobs `0027`, Documents
`0018`, Trust `0005_development_test_removal`, Profile `0011_active_candidate_lease`,
and Applications through `0015`,
before an image can be considered locally buildable.
Every owner's exact SQL filenames must match the pinned inventory and the validated restore
manifest, and every bundled SQL file must match its manifest SHA-256 checksum. Missing/extra
files or changed SQL bytes fail closed, even when the total migration count is unchanged.
This is a generated-synthetic/default-dark source and artifact boundary. It does not establish
deployed Trust candidate-rights behavior, image publication, task-definition deployment,
migration execution, or a deployed restore.

For publication, first run read-only status:

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

The migration runtime uses the digest-pinned Alpine Node base and retains its accurate Alpine
package database so ECR can complete the required operating-system scan. The build removes npm,
Yarn, Corepack, `apk` itself, and `apk`'s timestamped operation log, while preserving the pinned TLS
runtime libraries, CA bundle, and deterministic package database.
Runtime execution remains numeric-non-root, read-only, capability-free, and no-new-privileges.

Publication first installs the exact platform manifest under the immutable
`MERGED_SHA-linux-amd64` handoff tag. Only after its manifest bytes, configuration, and compressed
layers read back exactly does the operator install the exported OCI index under the full source SHA
tag. The source tag must resolve to that exact index, containing exactly one `linux/amd64` child and
no attestation descriptors. ECR scanning is polled on the platform digest, never the parent index.
For a completed scan with no findings, ECR may omit the severity-count map; the operator accepts
that documented empty map as zero while still requiring both the status and findings envelopes.
The receipt separately records `indexDigest`, `platformDigest`, `configDigest`, the ordered
compressed-layer fingerprint, and the rootfs diff-ID fingerprint. Its `imageUri` is
`repository@platformDigest`, which is the only value suitable for the migration task.

ECR authentication uses a unique temporary Docker configuration below the ignored operator
directory. Before activating that isolated configuration, the operator copies only Docker's
discovered Buildx plugin executable into its `cli-plugins` directory; it never copies the user's
Docker configuration or credentials. The operator removes the directory after the push so the
short-lived registry token is not retained in the user's normal Docker configuration.

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
exact digest and manifest again, and repeats the completed zero-High/zero-Critical scan check.
Historical source verification attests the original image; it does not certify its compatibility
with newer deployment source. Deployment-specific source and schema gates still apply. Pass
only the verified digest URI to the separately reviewed migration task-definition plan. Do not use
the source tag in Terraform and do not run a migration merely because publication succeeded.

## Local source verification

The guard suite makes no AWS or Docker calls. Its source checks use a disposable local Git
repository to exercise current/ancestor commits and checkout cleanliness:

```powershell
powershell.exe -NoProfile -File scripts/tests/development-migration-image-publisher.tests.ps1
pwsh -NoProfile -File scripts/tests/development-migration-image-publisher.tests.ps1
```

It covers account/repository/KMS substitutions, missing/extra/wrong platforms, index/platform/config/
layer digest confusion, deterministic-build mismatch, wrong handoffs, incomplete or vulnerable
scans, version-1 and unsafe recovery states, receipt path traversal, and the absence of Terraform,
ECS execution, and ECR deletion operations. It also rejects an older D1 manifest/package boundary
instead of treating a previously valid receipt or image as current Phase 2 evidence.
The same suite executes the publisher's exact embedded smoke in disposable local fixtures with
the real runner/restore modules: the current 87 migrations pass, while every missing or
byte-modified SQL file, extra file, unchanged-count filename/version substitution and mismatched
manifest checksum fails. It makes no SQL connection or migration call. These fixture tests do
not replace the hardened final-image smoke, deterministic build identity, audit or registry scan.
