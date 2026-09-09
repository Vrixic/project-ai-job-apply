# Development Gateway Release

This procedure publishes and releases one exact gateway Lambda from merged `main` in the isolated
development account. It is the guarded local fallback when the protected GitHub publication
workflow cannot run. It does not alter the document-processing stage, parser-version pin,
migration image, public-route switch, identity settings, data resources, or durable workflows.

## Preconditions

- Use portable Terraform `1.16.2`, Node.js 24, pnpm `10.24.0`, and a temporary development IAM Identity
  Center session in `us-east-2`.
- Require a clean `main` checkout exactly equal to `origin/main`; pass that 40-character commit as
  `SourceSha`.
- Resolve the exact development account and encrypted state bucket locally. Do not copy their
  identifiers into repository evidence.
- Start from the checksum-reviewed, nonapplyable zero-change Terraform plan and exact adjacent
  `.baseline.json` sidecar emitted by document-dark `Verify`. The sidecar must have the canonical
  schema and bind the plan path/hash, source, account, region, current state lineage/serial,
  processing stage, parser pin, and document receipt. The plan must preserve the exact current
  variable inventory and have no meaningful resource or output changes. The
  release guard preserves every non-gateway variable and explicitly requires processing-dark
  triggers, the applied parser boundary, and an immutable migration digest.
- When a newer delivery has legitimately advanced shared Terraform state after the latest document
  handoff, run `CaptureBaseline` with a reviewed zero-drift seed and the exact verified document
  publication receipt. It refreshes a new plan from the seed's complete variable inventory,
  accepts only exit code zero, revalidates the document artifacts and live parser binding, and
  writes a source/state-bound schema-7 sidecar without mutating AWS resources. Historical gateway
  schema-6 captures remain readable by the gateway operator; they are not the different historical
  document Bootstrap schema-6 format and cannot be relabeled as migration inputs.
- A migration `Verify` handoff uses the canonical version-2 sidecar and additionally binds the
  immutable migration image explicitly. The gateway operator hashes the plan and sidecar before
  parsing, requires the exact version-2 key set, resolves the one local document-publication
  receipt matching its bound checksum, and cross-checks that receipt's parser/processor objects
  against the exact stage-specific Terraform variables. Canonical version-1 document-dark
  baselines remain accepted where valid, but KMS-only, stale-state, relabeled, extra/missing-field,
  cross-account, mutable-image, receipt-tampered, and plan-variable-tampered handoffs fail closed.
- Confirm the current alias is healthy, the database migrations include Jobs `0004_job_search`,
  the DLQs are empty, and current backup/PITR evidence is acceptable.

All generated receipts, plans, metadata, and logs remain under the ignored development
`.terraform` directory. Commands below use placeholders intentionally; resolve them only in the
operator shell.

## Capture a current baseline after shared-state advancement

```powershell
.\scripts\operate-development-gateway-release.ps1 -Action CaptureBaseline `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
  -BaselinePlanPath REVIEWED_ZERO_DRIFT_SEED -ReviewedBaselineSha256 SEED_SHA256 `
  -DocumentReceiptPath VERIFIED_DOCUMENT_RECEIPT `
  -ReviewedDocumentReceiptSha256 DOCUMENT_RECEIPT_SHA256
```

Review and retain both returned SHA-256 values. `CaptureBaseline` performs a refresh-backed plan
and is valid only when it is complete, nonapplyable, contains the exact declared variable set, and
has zero meaningful resource or output changes. It does not publish or deploy an artifact.

Schema 7 is shared with the migration operator. It preserves `DocumentReleaseSourceSha` from the
exact checksum-matched document publication receipt separately from the current `SourceSha`.
`DocumentSourceDeltaSha256` binds their Git ancestry and the full no-renames, full-index binary
patch using `development-document-current-baseline-delta-v1`. Added, modified, and deleted regular
blobs are accepted; renames, gitlinks, symlinks, incomplete Git results, and unexpected metadata
keys are rejected. This is provenance for retained immutable artifacts, not permission to deploy
the intervening product changes. The independent review covers both returned file checksums;
there is no additional ancestor-delta override for this exact-current capture.

Both consumers revalidate the document receipt's source and all immutable parser/processor
coordinates against the captured variables and planned functions, the plan-owned artifact
bucket/KMS key and migration repository, and the processor's exact numeric parser pin. Migration
`PlanTask`/`ApplyTask` require the capture's exact current source and state lineage/serial. After
an authorized migration, its `Verify` emits another schema-7 handoff with the new migration image
and current state while retaining the original document release and receipt. It never labels old
document artifacts with the migration source. Gateway post-apply `Verify` retains only its existing
one-serial reviewed-release exception; schema 7 adds no stale-state allowance.

After any other legitimate shared-state change, capture and review a fresh zero-drift baseline;
do not reuse an older sidecar by changing its serial, source, schema, or checksum fields. A seed
that produces additional routes or other changes is not a zero-drift baseline: first resolve that
separate staged rollout boundary, not the migration task guard.

## Publish and independently verify

```powershell
.\scripts\operate-development-gateway-release.ps1 -Action Publish `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT
```

The operator runs gateway tests and the centralized dependency audit, builds twice with the exact
commit embedded in the bundle and manifest, and requires byte-for-byte reproducibility. It then
conditionally writes exactly four new objects—ZIP, CycloneDX SBOM, manifest, and checksum—to the
Terraform-owned versioned, private, platform-KMS bucket. Existing object versions or delete markers
at any intended key fail closed. Publication changes no Lambda, alias, route, or trigger.

Give the returned receipt and SHA-256 to an independent reviewer. That reviewer runs:

```powershell
.\scripts\operate-development-gateway-release.ps1 -Action VerifyPublication `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
  -ReceiptPath RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256
```

Verification re-reads every exact S3 object version and checks its KMS key, checksum, length,
metadata, source commit, and artifact digest. Do not plan a release from an unverified receipt.

## Plan and review

```powershell
.\scripts\operate-development-gateway-release.ps1 -Action Plan `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
  -ReceiptPath RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256 `
  -BaselinePlanPath CURRENT_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
  -BaselineMetadataPath CURRENT_METADATA `
  -ReviewedBaselineMetadataSha256 METADATA_SHA256
```

The only acceptable meaningful addresses are:

- `module.platform.aws_lambda_function.gateway[0]` — in-place immutable code/version update;
- `module.platform.aws_lambda_alias.gateway[0]` — in-place move to the resulting numeric version.

Any create, delete, replacement, extra resource, protected function setting change, Terraform
variable inventory change, non-gateway input change, mutable migration image, or processing-trigger
enablement is a blocker. Review the saved plan locally without publishing its body or sensitive
values, then retain its exact SHA-256. The plan metadata preserves the reviewed baseline sidecar
checksum/schema, document receipt checksum, stage/parser pin, and migration image so `Apply`
rechecks the same handoff instead of accepting a later local substitution.

## Apply and verify

```powershell
.\scripts\operate-development-gateway-release.ps1 -Action Apply `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
  -ReceiptPath RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256 `
  -BaselinePlanPath CURRENT_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
  -BaselineMetadataPath CURRENT_METADATA `
  -ReviewedBaselineMetadataSha256 METADATA_SHA256 `
  -PlanPath RELEASE_PLAN -ReviewedPlanSha256 RELEASE_PLAN_SHA256
```

Apply rechecks all artifact, baseline, plan, account, source, and state lineage/serial bindings
before consuming the exact saved plan. It then requires the alias to target a positive numeric
version whose code checksum and `RELEASE_SHA` match the reviewed artifact. The direct Lambda matrix
proves health plus `POST /v1/jobs/search` JSON response shape and `200`, missing-auth `401`,
wrong-scope `403`, strict-body and query-string `400`, oversized-body `413`, wrong-media `415`, and
wrong-path `404`. Request query values are not printed or retained. A final refresh-backed plan is
parsed and must prove zero meaningful resources/outputs, the exact current variables, and only the
same bounded provider refresh drift accepted by the retained baseline guard.

The standalone `Verify` action repeats the live alias, direct-boundary, and zero-drift checks with
the same reviewed publication and baseline inputs. It performs no persistent application write.
If the reviewed apply completed but a verifier-only defect stopped the parent operator, `Verify`
may retain the applied release SHA as an ancestor of clean current `main` only when every
intervening change is a modified regular text file in the exact gateway verifier/test/validator/
runbook allowlist. Any application, Terraform, artifact, receipt, baseline, added/deleted/renamed,
binary, missing, or non-blob change fails closed; do not regenerate or reapply the release plan.
Because a successful gateway apply advances the shared Terraform state, this recovery form also
requires the exact checksum-reviewed gateway release plan. Its adjacent metadata must bind the
retained baseline state, and the live state may have the same lineage with exactly one serial
advance before immutable-alias, direct-boundary, and zero-drift verification all pass.

The first-release gate deliberately does not claim the `409 job_search_catalog_changed` deployed
case. A genuine stale cursor expires after 15 minutes and requires a catalog revision after cursor
issuance; the pre-release gateway cannot supply one. Prove `409` later through a separate,
checksum-reviewed migration/synthetic-acceptance procedure that obtains a real cursor, performs an
explicitly reviewed synthetic catalog revision, and invokes the route within the cursor lifetime.
Do not forge a cursor from server secrets or perform an ad hoc database mutation. Keep D1 search
catalog-change acceptance open until that guarded deployed evidence exists.

## Failure and recovery

- A publication failure may leave new immutable objects plus a `publishing` receipt. Never reuse,
  overwrite, or delete them; publish a new exact commit/digest only after cause review.
- A plan or pre-apply binding failure performs no cloud mutation. Generate a new plan after state,
  source, or receipt changes.
- If apply fails or the direct search boundary fails, stop. Do not blindly rerun or move the alias
  in the console. Use a separately generated and checksum-reviewed Terraform rollback plan that
  restores a previously accepted immutable artifact, then repeat the complete verification.
- Disable public runtime only through a separate reviewed `serverless_runtime_enabled=false` saved
  plan when fail-closed unavailability is explicitly required.
