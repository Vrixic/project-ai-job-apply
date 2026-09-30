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

## One-time document tailoring invoke grant (ADR-031)

The first release that lets the Gateway reach the Documents runtime for resume tailoring is the only
release allowed to change more than the Lambda function and alias. It is switched on with
`-EnableDocumentTailoringInvoke` on `Plan`, `Apply`, and standalone `Verify` (the switch sets the
default-off Terraform input `document_tailoring_invoke_enabled` to `true`). Without the switch every
release remains the exact two-resource plan.

The guard accepts exactly four updates and nothing else:

1. `aws_lambda_function.gateway[0]` and `aws_lambda_alias.gateway[0]`, as usual, plus exactly one added
   function variable, `DOCUMENT_TAILORING_FUNCTION_ARN`, equal to the qualified
   `ai-job-apply-development-document-processor:development` alias ARN in the reviewed account.
2. `aws_iam_role_policy.gateway_lambda[0]`, gaining exactly one statement `InvokeExactDocumentTailoringRuntime`
   (`Allow`, `lambda:InvokeFunction`, that one alias ARN, no condition, no principal).
3. `aws_vpc_endpoint.lambda[0]`, gaining exactly one statement `GatewayInvokesExactDocumentProcessorAlias`
   (same action and resource, principal exactly the Gateway role).

Every existing statement must be byte-for-byte unchanged, no field other than the policy may change, no
unknown field is allowed, and the switch may move only from `false` to `true`. The processor alias must
already be deployed and live-verified before this release, because the grant only names it. After apply,
`Verify` must return zero drift; seed later baselines from that verification plan so the switch stays on.

After the invoke grant is applied, a refresh-backed plan lists `aws_iam_role.gateway_lambda[0]` as drift
because the role's computed `inline_policy` snapshot in state still holds the older policy text. The guard
accepts that one provider-observed record only when nothing else about the role differs, the live policy equals
the exact source-evaluated policy, and the difference is exactly the one reviewed `InvokeExactDocumentTailoringRuntime`
statement; any other change to that role, a second or altered statement, unknown fields, replacement paths, or a
duplicate record is refused. It disappears once state is refreshed.
## Optional document processor refresh (ADR-031)

The same release may also move the document processor to a newly published, independently verified
document artifact, so the Gateway's tailoring request is served by the matching code. Add
`-RefreshDocumentProcessor` with `-DocumentReceiptPath` and `-ReviewedDocumentReceiptSha256` to `Plan`,
`Apply`, and standalone `Verify` (the switch has no effect on `CaptureBaseline`). Without the switch the
processor, its alias, and every document variable stay exactly as they are.

The operator reads the receipt from the ignored document artifact directory, requires its
checksum, its exact release source, the live artifact and KMS boundary, and independent exact-version
readback of the processor archive (version, length, checksum, customer KMS key, source and artifact
metadata). The guards then accept exactly two more updates: `aws_lambda_function.document_processor[0]`,
changing only its code coordinates and `RELEASE_SHA` to that archive, and `aws_lambda_alias.document_processor[0]`,
changing only its numeric version. The parser and its numeric pin, the processor IAM policy, environment,
layers, network, every trigger, and every other variable must be unchanged, and the four
`document_processor_artifact_*` variables must equal the receipt exactly. It may be combined with the invoke
grant above, in which case the plan has exactly six updates. Later baselines must be seeded from the
resulting verification plan so the new processor coordinates are retained.
`-RefreshDocumentParser` does the same for the document parser: the guards accept exactly
`aws_lambda_function.document_parser[0]` (only its code coordinates and `RELEASE_SHA`) and
`aws_lambda_alias.document_parser[0]` (only its numeric version), the four `document_parser_artifact_*`
variables must equal the receipt, and the processor's numeric parser pin, the parser and object-access
policies, environment (including `DOCUMENT_PARSER_VERSION`), network, and triggers must be unchanged. The
processor and parser refreshes are independent and may be combined with each other and with the invoke grant
(up to eight updates). Refresh both from one receipt so a retained baseline, which requires one publication
receipt to describe both deployed archives, stays valid; a mixed release is refused at baseline capture.
Updating the parser function publishes a new version, so Terraform also reports the output
`document_parser_version_arn` as changed (its new value is known only after apply). That single computed update
is accepted, but only for that output, only with `-RefreshDocumentParser`, only for the parser's own
`ai-job-apply-development-document-parser` version ARN in the reviewed account and region, and only as a
non-sensitive update to an unknown value; every other output change is still refused. The processor's numeric
parser pin is a variable and does not move with it.
## Converging a mixed document release (schema-8 baseline)

Status as of 2026-09-19 (tracked as D3-020 and D3-R7 in the Phase 3 record). The ADR-031 release refreshed only
the document processor, leaving development with the parser from `43f69e9` and the processor from `9240c6b`.
A schema-7 baseline needs one document publication receipt to describe both deployed archives, so no baseline
could be captured and no Gateway release could be planned. The environment itself is healthy and serves the
feature. The product owner approved the transitional baseline below on 2026-09-19 (owner statement in chat).

Do not work around a mixed release with raw Terraform, an older receipt, or a hand-edited sidecar.

**Converged 2026-09-20.** The release ran from a schema-8 baseline (state serial 374): one document receipt refreshed
both archives (parser to version 7, processor to version 12) with the Gateway (version 80) in a plan of exactly
six updates plus the one accepted parser-version output change, applied and verified with zero drift. A schema-7
baseline was then captured from that single receipt (state serial 375), so schema 8 is no longer needed and stays
available only for a future mixed release.

Rules, all enforced by the guards and covered by tests:

- **Schema 8 is schema 7 plus three keys**: `ProcessorReceiptSha256`, `ProcessorReleaseSourceSha`, and
  `ProcessorSourceDeltaSha256`. `ReceiptSha256` and `DocumentReleaseSourceSha` then describe only the deployed
  parser, and the processor keys describe only the deployed processor. The two receipts must be different files.
- **Each receipt is verified to the full single-receipt standard for its own archive only**: its own release
  source, the live artifact and KMS boundary, the verified phase, the exact eight immutable objects, and the exact
  plan variables and function coordinates of that archive. The stage must be `complete-dark`. A receipt cannot
  vouch for the other archive.
- **Only the Gateway operator accepts schema 8** (it passes `-AllowTwoReceipts`). The document migration and D2
  operators reject it.
- **Convergence only**: `Plan`, `Apply`, and `Verify` from a schema-8 baseline require `-RefreshDocumentParser`
  and `-RefreshDocumentProcessor` together, from one new receipt at the release commit. It is never used for a
  Gateway-only release. After it, the deployed release is single-receipt again and later baselines are schema 7.

Procedure (one release commit `X`; merge nothing between steps 2 and 6, because every merge invalidates
source-bound evidence):

1. Confirm `main` equals `origin/main` at `X`, clean, and the portable Terraform is selected.
2. Publish the document Lambdas from `X` with `publish-development-document-lambdas.ps1` (`Publish`, then
   `Verify`). This produces the one new receipt `R`.
3. Produce the reviewed zero-drift seed of the deployed state, as for any baseline capture.
4. Capture the baseline from the two receipts that describe what is deployed now:

```powershell
.\scripts\operate-development-gateway-release.ps1 -Action CaptureBaseline `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha X `
  -BaselinePlanPath REVIEWED_ZERO_DRIFT_SEED -ReviewedBaselineSha256 SEED_SHA256 `
  -DocumentReceiptPath PARSER_RECEIPT -ReviewedDocumentReceiptSha256 PARSER_RECEIPT_SHA256 `
  -ProcessorDocumentReceiptPath PROCESSOR_RECEIPT -ReviewedProcessorDocumentReceiptSha256 PROCESSOR_RECEIPT_SHA256
```

5. `Plan`, review, `Apply`, and `Verify` with `-RefreshDocumentParser -RefreshDocumentProcessor` and
   `-DocumentReceiptPath R` (plus the usual Gateway publication receipt and baseline inputs).
6. The next `CaptureBaseline` uses `R` alone and produces a schema-7 baseline.

## Activating the document scan triggers (D3-023)

Enables or disables the document scan triggers in development, one reviewed step at a time, with the Gateway
operator's `-DocumentScanActivation` mode. It changes exactly two Terraform variables and the three resources they
drive, and nothing else; it never carries a Gateway or document Lambda change and is never combined with a release.
ADR-023 fixes the order: the processor mapping and timeout reconciler first, then the exact GuardDuty rule.

| Step | Variables (from, to) | Resources updated in place |
|---|---|---|
| `EnableMapping` | mapping false to true | the processor SQS mapping (`enabled`) and the 15-minute reconciler rule (`state`) |
| `EnableRule` | rule false to true (mapping already true) | the GuardDuty scan-result rule (`state`) |
| `DisableRule` | rule true to false | the GuardDuty scan-result rule |
| `DisableMapping` | mapping true to false (rule already false) | the mapping and the reconciler rule |

Rules, enforced by [the guards](../../../scripts/lib/development-document-scan-activation-guards.ps1) and tested with generated fixtures in the real Terraform shape:

- **A current schema-7 baseline is required** (captured at the release commit from a zero-drift seed and the one document
  receipt), and it must be exactly where the step starts. A reviewed plan cannot be replayed as a different step.
- **The plan must be exactly the reviewed change**: only those resources, `update` in place, one attribute each between
  the reviewed values, no unknown or sensitive change, no output change, and every other variable unchanged.
- **Apply** takes the reviewed plan and its SHA-256, requires unchanged state, applies only that saved plan, then reads
  the live mapping (enabled state, batch size 1, concurrency 2, processor alias) and both rules back from AWS and
  requires a zero-drift plan with the new flags. **Verify** does the same after exactly one state advance.

```powershell
.\scripts\operate-development-gateway-release.ps1 -Action Plan -DocumentScanActivation EnableMapping `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
  -BaselinePlanPath BASELINE -ReviewedBaselineSha256 BASELINE_SHA256 `
  -BaselineMetadataPath BASELINE_METADATA -ReviewedBaselineMetadataSha256 METADATA_SHA256
# review the plan, then Apply (same inputs plus the plan)
.\scripts\operate-development-gateway-release.ps1 -Action Apply -DocumentScanActivation EnableMapping `
  [same inputs] -PlanPath ACTIVATION_PLAN -ReviewedPlanSha256 ACTIVATION_PLAN_SHA256
```

Rollback is the inverse step from a fresh baseline (`DisableRule`, then `DisableMapping`). A later Gateway release
carries the activated state forward: the release guard requires both flags to equal the retained baseline and only
refuses a shape ADR-023 does not allow (the rule without the mapping, or any trigger outside the complete boundary).

**Boundary.** ADR-023 accepts this only for generated-synthetic development processing. Nothing in the upload path
checks content, so the operating rule is that only generated-synthetic resumes are uploaded while a trigger is on; real
resumes stay blocked until the ADR-023 gates are met (see the [activation design](../../../docs/security/d3-023-document-processing-activation.md)).

## Allowing an upload origin (D3-024)

The candidate-document bucket only lets a browser post to a short-lived, exact upload grant from origins listed in
`candidate_document_cors_allowed_origins`. It held only `http://localhost:3000`, so the hosted app's browser could
not post a resume. The Gateway operator's `-DocumentUploadCorsOrigin` mode appends one exact origin, one reviewed step
at a time, from a current schema-7 baseline, and never with a release or a trigger activation.

Rules, enforced by [the guards](../../../scripts/lib/development-document-upload-cors-guards.ps1) and tested with generated fixtures in the real Terraform shape:

- **One exact origin**: lowercase `https://`, dotted host, optional port, no wildcard, path, query, or credentials, and
  not already in the list. The planned list must be exactly the retained list with that origin appended.
- **One resource, in place**: the plan must be exactly one update of the bucket CORS configuration with only that origin
  added. Any other change, output, unknown value, or sensitive value, another rule, changed methods, headers, exposed
  headers, or max age, or a different bucket is refused, as is any other changed variable.
- **Apply** takes the reviewed plan and SHA-256, requires unchanged state, applies only that saved plan, reads the live
  bucket CORS back (one rule, the exact origin list, `POST`, `*`, the two exposed headers, 300 seconds), and requires a
  zero-drift plan. **Verify** does the same after exactly one state advance.

```powershell
.\scripts\operate-development-gateway-release.ps1 -Action Plan -DocumentUploadCorsOrigin https://EXACT-ORIGIN `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
  -BaselinePlanPath BASELINE -ReviewedBaselineSha256 BASELINE_SHA256 `
  -BaselineMetadataPath BASELINE_METADATA -ReviewedBaselineMetadataSha256 METADATA_SHA256
# review the plan, then Apply (same inputs plus -PlanPath and -ReviewedPlanSha256)
```

Presigned upload grants stay exact (object key, size, checksum, encryption, and expiry); CORS only lets the listed
origin's browser use them. Removing an origin is a separate reviewed change and is not part of this mode.

**After the change, one refresh record is expected.** Terraform's S3 bucket resource also reads back the bucket's CORS
rules, and its state keeps the old list until an apply commits the refresh, so each later plan reports one drift record
on `aws_s3_bucket.candidate_documents[0]` whose only difference is `cors_rule`. The shared drift check accepts exactly
that record: the rule keeps the same methods, headers, exposed headers, and max age, the origin list is the old list with
origins appended and equals the list the source-evaluated CORS configuration plans, and nothing else about the bucket, its
sensitivity, or its unknown values differs. A record that changes anything else is refused. The next apply commits the
refreshed state and the record stops appearing.

## Refreshing the candidate-rights activity code (D3-027)

The resume byte purge (ADR-034) runs in the profile-readiness activity Lambda's `rate(5 minutes)` maintenance handler, so
its code has to reach that Lambda without changing anything else. The Gateway operator's `-RefreshCandidateRightsActivity`
mode does this from a current schema-7 baseline and a verified core-workflow publication receipt, one reviewed plan at a
time, and never with a release, a trigger activation, or a CORS change.

The same archive also serves the terminal Lambda, and the module binds the activity version into the durable workflow, so
the change is wider than one function. The owner approved this exact set on 2026-09-21; the guards
([library](../../../scripts/lib/development-candidate-rights-activity-guards.ps1)) refuse any other:

- **Updates in place**: the activity Lambda and its alias, the terminal Lambda and its alias, the CloudFormation-published
  durable stack (a new coherent durable version and alias), the durable role policy (invoke the new activity version), the
  outbox-starter Lambda, alias, and role policy (they point at the durable version), the terminal event rule, and the
  Lambda VPC endpoint policy. **One replacement**: the durable policy-propagation timer. **Two output changes**: the
  durable alias and version ARNs.
- **Only the four activity artifact variables change**, and they must equal the receipt's activity archive exactly; every
  other variable and the variable inventory are identical, the durable and candidate-rights flags stay enabled, and an
  archive that is already released is refused. Each resource may differ only in its reviewed attributes, unknown values
  are limited to the reviewed ones, no new sensitive value is allowed, and any other resource or output change refuses.
- **Publish first**: `operate-development-workflow-lambda-publication.ps1 -Action Publish` (then `Verify`) from the merged
  commit writes the immutable archive and its receipt; the mode re-reads the exact object version, checksum, KMS key, and
  metadata before planning.
- **Apply** takes the reviewed plan and SHA-256, requires unchanged state, applies only that saved plan, then reads the live
  chain back: both Lambdas run the reviewed archive, the durable version invokes the new activity version, the terminal
  Lambda, outbox starter, and terminal rule name the new durable version, and the durable role may invoke exactly the new
  activity version. It then requires a zero-drift plan. **Verify** does the same after exactly one state advance.

```powershell
.\scripts\operate-development-gateway-release.ps1 -Action Plan -RefreshCandidateRightsActivity `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
  -WorkflowReceiptPath WORKFLOW_RECEIPT -ReviewedWorkflowReceiptSha256 RECEIPT_SHA256 `
  -BaselinePlanPath BASELINE -ReviewedBaselineSha256 BASELINE_SHA256 `
  -BaselineMetadataPath BASELINE_METADATA -ReviewedBaselineMetadataSha256 METADATA_SHA256
# review the plan, then Apply (same inputs plus the plan)
.\scripts\operate-development-gateway-release.ps1 -Action Apply -RefreshCandidateRightsActivity `
  [same inputs] -PlanPath ACTIVITY_PLAN -ReviewedPlanSha256 ACTIVITY_PLAN_SHA256
```

Rollback is a fresh baseline and a plan that restores the previous receipt's archive through a separately reviewed release.

## Activating D3 platform capabilities (D3-001 and D3-005)

### Restricted-answer export activation

After the vault and candidate-rights runtime are already activated, use the activity-refresh
commands above with the additional `-EnableRestrictedAnswerExport` switch on Plan, Apply, and
Verify. This is a separate reviewed release, never combined with Gateway/document changes. The
new source defaults `restricted_answer_export_enabled` to false in both environments. Publish and
independently verify its immutable core-workflow artifact, then capture a fresh schema-7 zero-drift
baseline at the merged source. Plan changes only the four activity artifact inputs plus that flag
from false to true. No migration is required.

The activation guard admits the existing exact activity release chain plus one rights-role policy
update. Its only new statement is purpose-bound `kms:Decrypt` on the existing dedicated vault key;
all prior statements and policy attributes remain unchanged. Only the activity gains
`RESTRICTED_ANSWER_EXPORT_ENABLED=enabled` and the exact `RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN`.
The saved metadata binds activation mode. The owner reviews the exact saved plan and metadata
hashes before Apply. Apply/Verify read back the immutable chain, exact activity environment, and
full rights policy, then require zero drift. Unexpected provider drift still refuses.

After a successful export activation, Terraform may report an `inline_policy` refresh on the
activity role because the separately managed rights policy has already gained the export grant.
The verifier accepts only the exact source-evaluated activity role and dedicated same-account key,
with all four prerequisites enabled, the same two inline-policy names, and exactly one added
purpose-bound Decrypt statement. Existing statements, the other inline policy, role attributes,
and sensitivity metadata must remain unchanged. Unknown values, replacement paths, duplicate
records, and unrelated drift still refuse.

If apply completed and live-chain checks passed but this final refresh check failed, do not apply
again. Retain the original source, artifact receipt, baseline, saved plan, metadata, and hashes.
After the verifier-only repair merges, run `-Action Verify -RefreshCandidateRightsActivity
-EnableRestrictedAnswerExport` with those original inputs. The existing ancestor-source allowlist
admits only its named verifier/runbook/delivery-record changes; it does not relabel or republish
artifacts. Verification still requires the exact permitted state advance and a fresh zero-change
plan. The 2026-09-30 export activation has a non-reusable exception: Terraform committed three
snapshots during that single apply (baseline serial 395, current serial 398). Only activation
`Verify` may use it, with the exact original source, workflow receipt, baseline/sidecar, saved
plan/metadata hashes and three distinct versioned-backend records at `17:22:03Z`, `17:22:28Z`,
and `17:22:41Z` on that date. History must be complete with no later snapshot or deletion; only
the last record is latest. Different releases, state lineages, serials, timestamps, or evidence
refuse. Plan, Apply, ordinary refresh, and every other reader retain their existing boundaries.
No old baseline or receipt is edited. Local inspection of the retained plan is diagnostic evidence,
not a substitute for the full standalone live verification.

The recovery sidecar is resolved from the script-scoped release-plan argument, not the
case-insensitively named local baseline path. After the exact history check and both baseline
readers succeed, their result carries the observed recovery lineage/serial. The activity's final
fresh state read must still match that result, the pinned release source, and serials 395/398.
Missing, malformed, or stale recovery evidence refuses; ordinary verification still accepts only
one advance, and Apply still requires unchanged reviewed state. Operator tests execute the real
recovery branch in the shadowing scope and exercise the final state check on both PowerShell hosts.
They also execute the actual activity Verify command through live/drift stages with generated
native mocks, require the helper call in that branch, and preserve CORS's separate one-advance
check. Those mocks are regression coverage, not deployed acceptance.

Before real-data activation, complete accountable security/privacy review. Generated-synthetic
acceptance must prove exported latest active and expired values, metadata-only tombstones, owner
isolation, failure redaction, artifact expiry/deletion, and no sensitive logs or durable payloads.
This implementation does not itself provide any deployed acceptance. Ordinary refresh does not
enable the flag or grant decryption; disabling it requires a fresh separately reviewed plan rather
than reusing the activation plan or downgrading to a worker that silently omits saved values.

The `-D3PlatformActivation` mode enables exactly one default-off capability from a current
schema-7 baseline. It cannot be combined with a Gateway release, document refresh, scan
activation, upload-origin change, candidate-rights activity refresh, or the other D3 capability.
After one capability advances state, capture and review a fresh zero-drift baseline before
planning the other.

### Restricted answer vault

```powershell
.\scripts\operate-development-gateway-release.ps1 -Action Plan `
  -D3PlatformActivation RestrictedAnswerVault `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
  -BaselinePlanPath BASELINE -ReviewedBaselineSha256 BASELINE_SHA256 `
  -BaselineMetadataPath BASELINE_METADATA `
  -ReviewedBaselineMetadataSha256 METADATA_SHA256

# Only after independent review of the exact saved plan and SHA-256:
.\scripts\operate-development-gateway-release.ps1 -Action Apply `
  -D3PlatformActivation RestrictedAnswerVault [same inputs] `
  -PlanPath VAULT_PLAN -ReviewedPlanSha256 VAULT_PLAN_SHA256
```

The guard accepts only creation of the dedicated rotating KMS key and alias plus the exact
in-place Gateway role-policy, function-environment, and immutable-alias updates. It refuses any
delete, replacement, output change, scheduler resource, unrelated input, or combined activation.
After apply it reads the separate customer key, rotation state, Gateway key binding, and exact
Encrypt/Decrypt role statement, runs the direct Gateway boundary suite, and requires zero drift.

### Applications attempt recovery

First publish and verify the exact artifact through the
[Applications recovery publication runbook](development-applications-recovery-publication.md).

```powershell
.\scripts\operate-development-gateway-release.ps1 -Action Plan `
  -D3PlatformActivation ApplicationsAttemptRecovery `
  -ApplicationsRecoveryReceiptPath VERIFIED_RECEIPT `
  -ReviewedApplicationsRecoveryReceiptSha256 RECEIPT_SHA256 `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
  -BaselinePlanPath BASELINE -ReviewedBaselineSha256 BASELINE_SHA256 `
  -BaselineMetadataPath BASELINE_METADATA `
  -ReviewedBaselineMetadataSha256 METADATA_SHA256

# Only after independent review of the exact saved plan and SHA-256:
.\scripts\operate-development-gateway-release.ps1 -Action Apply `
  -D3PlatformActivation ApplicationsAttemptRecovery [same inputs] `
  -PlanPath RECOVERY_PLAN -ReviewedPlanSha256 RECOVERY_PLAN_SHA256
```

The plan must create only the isolated role and policy, encrypted DLQ, immutable Lambda and alias,
five-minute EventBridge rule and target, exact invoke permission, and two alarms, plus the in-place
private Secrets Manager endpoint-policy update that admits the new role. The Lambda is bound to
the receipt's exact object key, version, and digests. Live verification checks the numeric alias,
code digest, release identity, concurrency of one, enabled five-minute rule, retry/DLQ target, and
the endpoint's exact role admission, then requires zero drift. It does not invoke recovery by
hand; the enabled reviewed schedule owns execution.

For either component, `Verify` normally accepts the same reviewed plan only after exactly one state
advance. The 2026-09-29 recovery activation has one non-reusable exception pinned to its exact
source, receipt, baseline, metadata, plan, and two consecutive versioned-backend timestamps because
Terraform 1.16.2 wrote an intermediate and final snapshot during that apply. No other two-serial
advance is accepted.
A failed plan performs no cloud mutation. A failed apply or live check is not permission to rerun,
edit state, or change resources in the console. Diagnose it and use a separately generated,
checksum-reviewed rollback plan from the new current baseline.

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
