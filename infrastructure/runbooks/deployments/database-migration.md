# Database Migration

Run schema changes through the retained one-off ECS/Fargate migration task. The ECS cluster has no
service and must return to zero running tasks after every migration.

## Preconditions

- Use exact merged source, portable Terraform `1.16.2`, and the selected environment's temporary IAM
  Identity Center profile in `us-east-2`.
- Confirm RDS is available, encrypted, deletion protected, and covered by current backups/PITR.
- Build only `Dockerfile.migration`; push it to the environment-local immutable, KMS-encrypted,
  scan-on-push `ai-job-apply/migration` repository.
- Confirm the image contains the migration orchestrator plus every declared independently
  checksum-verifying service-owned migration package. The orchestrator must run owners in declared
  order and stop before later owners if any owner fails.
- For the Phase 2 package, require the exact
  `d2-community-lifecycle-profile-jobs-documents-matching-billing-trust-v1` manifest, the ordered Profile,
  Jobs, Documents, Matching, Billing, and Trust runners, ten declared schemas, 68 declared regular
  relations, and 44 checksum-bound migrations, including Jobs `0023` and Trust `0004` before enabling
  the compatible Gateway or either D2 worker. Reject older D1 package and
  receipt boundaries.
- Before Jobs `0023`/Trust `0004`, pause D2 contribution/reviewer writes and both workers through
  `d2_community_runtime.maintenance_mode = true`. Verify the exact disabled-version aliases,
  existing false handler flags, both function reservations at zero, disabled EventBridge schedule,
  and Trust mapping state `Disabled`. Drain already-running work before applying SQL. Do not use
  `enabled = false`, which removes active resources/configuration instead of pausing them.
- Require the exact platform digest to have a complete scan with zero High or Critical findings.
- Review the SQL for transactional behavior, replay safety, bounded locks, data classification,
  downgrade/forward-recovery strategy, and aggregate-only observability.

## Deploy the task definition

Create a refresh-backed Terraform plan with the exact digest URI. The plan may replace only the
one-off migration task definition and narrow execution-secret policy when required. Review and
apply its exact SHA-256. Require a read-only root filesystem, non-root image user, Fargate,
`awsvpc`, the migration command, and only the database secret.

For a development document-schema release, use
`scripts/operate-development-document-migration.ps1`. Keep every saved plan, metadata sidecar,
execution descriptor, receipt, and log under the ignored development `.terraform` directory.
Supply the exact account and state bucket out of band; do not record them in source or shared
evidence.

The task release is deliberately review-separated:

For a current development release, the supported direct handoff is schema 7 from
`scripts/operate-development-gateway-release.ps1 -Action CaptureBaseline`. Capture uses a reviewed
zero-drift seed and the exact verified document publication receipt; it returns a new plan and
adjacent `.baseline.json` with separately reviewable SHA-256 values. Pass those returned values
unchanged to `PlanTask` as `AppliedPlanPath`, `AppliedPlanSha256`, and
`AppliedPlanMetadataSha256`. Omit `ReviewedBaselineToCurrentDeltaSha256`: this path requires exact
current source and state and rejects an ancestor override.

Schema 7 binds the real `DocumentReleaseSourceSha` separately from the current capture source,
plus their domain-separated `DocumentSourceDeltaSha256`, all document receipt/artifact/function
coordinates, plan-owned bucket/KMS/repository, stage, and numeric parser pin. The task metadata
continues to bind the original sidecar's exact bytes. Post-migration `Verify` reauthenticates that
sidecar and emits schema 7 with the new migration image/current state and the original document
release/receipt. It must not normalize the old document receipt to the new migration source.

Historical schema-6 Bootstrap baselines retain their original validation; gateway's older
schema-6 captures have a different shape and remain invalid migration inputs. Obtain a fresh
schema-7 capture rather than relabeling either format, accepting a stale serial, weakening
zero-drift checks, or deploying unrelated ingestion artifacts just to regenerate old evidence.

Release ordering is migration package publication and scan, verified D2 maintenance and running-work
drain, `PlanTask`/`ApplyTask`, reviewed `PlanExecution`/single `Execute`/`Verify`, and compatible D2
worker/Gateway upgrades while maintenance stays enabled. Schedule the migration execution near or
after the asynchronous retirement deadline: resume independently describes the actual stopped task,
and AWS only guarantees stopped-task visibility for [at least one hour](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DescribeTasks.html).
Publish artifacts and prepare the reviewed release beforehand so the final task verification and
compatible runtime transitions can finish within that window. Resume only after the verified schema,
artifacts and asynchronous retirement fence all pass. Other route or runtime changes require their
own exact reviewed plan; none may enter the migration task-only replacement plan.

The previous worker uses `ON CONFLICT (contribution_id)`, whose singleton constraint Jobs `0023`
removes. Old Trust acceptance lacks the provider-proof basis required by Trust `0004`. Neither old
writer can be restored after migration. Zero concurrency is function-wide but does not terminate an
already-running invocation. Keep both workers fenced while the owners migrate independently.

For the retained alias-only EventBridge target, verify that all aliases have moved to disabled
versions with no weighted old-version route and that no other numeric-version ingress exists.
Record the confirmed cutoff and preserve the existing asynchronous retention bound: ordinarily
21,600 seconds, plus the prior maximum running timeout and a settling margin, before restoring
concurrency. A new retry setting, empty metrics, or one timeout does not prove old accepted async
work disappeared. Later EventBridge deliveries resolve the verified disabled alias; this is an
inference from documented [alias targeting](https://docs.aws.amazon.com/lambda/latest/dg/using-aliases.html),
not a claim that queued work is rebound or purged. Preserve queued contribution/signal records and
immutable artifacts; no historical function-version deletion is authorized by this procedure.

The pause receipt retains its original source and cutoff across reviewed descendant releases while
the exact paused authority and live controls remain unchanged. Any out-of-band alias, trigger or
reservation change invalidates that cutoff and requires a newly verified pause and full retirement
window. Current metrics alone cannot prove uninterrupted fencing; do not rewrite an old receipt or
claim an automatic safe resume.

When an ancestor `CompleteDark` baseline is required, derive the review value independently from
the exact merged commits before invoking `PlanTask`. Run this from clean `main == origin/main`,
inspect the detected records and `numstat` before accepting the digest, and stop on any rename,
binary record, unsupported status, non-regular mode, unbound copy detection, or Git error. Git copy
detection is heuristic, so a detected copy is admitted only when the canonical no-renames delta
records its destination exactly once as added, its source is a retained regular blob at both
commits, and its destination did not exist at the baseline. The operator independently repeats
these checks; this review command does not authorize planning:

```powershell
$baselineOperatorSha = '9d290416c61847f1682157c08312cdb920d42107'
$currentOperatorSha = '<MERGED_40_CHARACTER_COMMIT>'
$repo = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Repository root resolution failed.' }
& git -C $repo merge-base --is-ancestor $baselineOperatorSha $currentOperatorSha
if ($LASTEXITCODE -ne 0) { throw 'The retained baseline operator is not an ancestor.' }
$detected = @(& git -C $repo diff --name-status --find-renames --find-copies-harder `
    "$baselineOperatorSha..$currentOperatorSha")
if ($LASTEXITCODE -ne 0 -or $detected.Count -eq 0) {
  throw 'The detected delta is unreadable or empty.'
}
if (@($detected | Where-Object { $_ -match '^R[0-9]*\t' }).Count -ne 0) {
  throw 'The detected delta contains a rename.'
}
if (@($detected | Where-Object {
      $_ -notmatch '^(?:A|M|D)\t[^\t]+$' -and
      $_ -notmatch '^C[0-9]+\t[^\t]+\t[^\t]+$'
    }).Count -ne 0) {
  throw 'The detected delta contains an unsupported record.'
}
$detectedCopies = @($detected | Where-Object { $_ -match '^C[0-9]+\t' })
$records = @(& git -C $repo diff --name-status --no-renames `
    "$baselineOperatorSha..$currentOperatorSha")
if ($LASTEXITCODE -ne 0) { throw 'The canonical name-status delta failed.' }
$numstat = @(& git -C $repo diff --numstat --no-renames `
    "$baselineOperatorSha..$currentOperatorSha")
if ($LASTEXITCODE -ne 0 -or $numstat.Count -ne $records.Count -or
    @($numstat | Where-Object { $_ -match '^-\t-\t' }).Count -ne 0) {
  throw 'The canonical delta is binary or structurally ambiguous.'
}
foreach ($record in $records) {
  if ($record -notmatch '^(A|M|D)\t([^\t]+)$') {
    throw 'The canonical delta contains an unsupported record.'
  }
  $status = $Matches[1]
  $path = $Matches[2]
  $revision = if ($status -ceq 'D') { $baselineOperatorSha } else { $currentOperatorSha }
  $entry = @(& git -C $repo ls-tree $revision -- $path)
  if ($LASTEXITCODE -ne 0 -or $entry.Count -ne 1 -or
      [string]$entry[0] -notmatch '^(100644|100755) blob [a-f0-9]{40,64}\t') {
    throw 'A canonical delta path is not one regular blob.'
  }
}
foreach ($copyRecord in $detectedCopies) {
  $null = $copyRecord -match '^C[0-9]+\t([^\t]+)\t([^\t]+)$'
  $sourcePath = $Matches[1]
  $destinationPath = $Matches[2]
  if (@($records | Where-Object { $_ -ceq "A`t$destinationPath" }).Count -ne 1) {
    throw 'A detected copy destination is not one canonical added path.'
  }
  foreach ($revision in @($baselineOperatorSha, $currentOperatorSha)) {
    $sourceEntry = @(& git -C $repo ls-tree $revision -- $sourcePath)
    if ($LASTEXITCODE -ne 0 -or $sourceEntry.Count -ne 1 -or
        [string]$sourceEntry[0] -notmatch '^(100644|100755) blob [a-f0-9]{40,64}\t') {
      throw 'A detected copy source is not one retained regular blob.'
    }
  }
  $oldDestination = @(& git -C $repo ls-tree $baselineOperatorSha -- $destinationPath)
  if ($LASTEXITCODE -ne 0 -or $oldDestination.Count -ne 0) {
    throw 'A detected copy destination already existed in the retained baseline.'
  }
}
$patch = @(& git -C $repo diff --full-index --binary --no-ext-diff --no-renames `
    "$baselineOperatorSha..$currentOperatorSha")
if ($LASTEXITCODE -ne 0) { throw 'The canonical patch failed.' }
$payload = "development-operator-delta-v1`n$baselineOperatorSha`n$currentOperatorSha`n--name-status--`n" +
  (($records -join "`n") + "`n--patch--`n" + ($patch -join "`n") + "`n")
$utf8 = New-Object System.Text.UTF8Encoding($false)
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  ($sha256.ComputeHash($utf8.GetBytes($payload)) |
      ForEach-Object { $_.ToString('x2') }) -join ''
} finally {
  $sha256.Dispose()
}
```

Independently inspect every `A`, `M`, or `D` path at the applicable commit with `git ls-tree` and
require mode `100644` or `100755` plus object type `blob`. Record the resulting lowercase digest
as `ReviewedBaselineToCurrentDeltaSha256`; do not reuse a digest after the merged commit changes.

1. `PlanTask` verifies the merged source and immutable ECR artifact, reconstructs every existing
   Terraform input from the checksum-bound retained `ParserDark` or `CompleteDark` verification
   plan, and saves a refresh-backed plan. The adjacent `.baseline.json` sidecar is mandatory and
   must bind its exact release/operator source, account, region, absolute plan path/hash,
   approved-version zero-change shape (1.16.2 current; 1.9.8 historical read-only), retained state lineage/serial, exact variable set,
   publication receipt, rollout stage, and applicable parser-version pin. A
   KMS-prerequisite-only baseline is rejected. An exact-current retained baseline requires
   `-ReviewedBaselineToCurrentDeltaSha256` to be omitted. An older retained baseline is accepted
   only from a schema-3 or schema-4 `CompleteDark` sidecar: its stored
   release-to-baseline-operator delta must still validate, its operator commit must be an ancestor
   of clean `main == origin/main`, and both `PlanTask` and `ApplyTask` must receive the
   independently reviewed SHA-256 of the complete canonical baseline-operator-to-current Git
   delta. The delta admits only unambiguous added, modified, or deleted regular blobs, with no
   rename, binary, missing, symlink, gitlink, or mode ambiguity. A heuristic copy detection is
   admitted only for one canonical added destination absent at the baseline and a regular-blob
   source retained at both commits; a missing, unexpected, or mismatched checksum fails closed.
   This does not broaden the document-dark recovery allowlist.
   Older Terraform state is not generally accepted. The historical stale-state handoff is the exact
   reviewed schema-3 CompleteDark baseline at operator `9d290416c61847f1682157c08312cdb920d42107`,
   plan SHA-256 `2143c836f9c55d2126efef55b314f167b35d593d64338791cb6c3837c6e2a6a4`,
   metadata SHA-256 `e0efc63e7c17685e363e23f15f7f1d39e83c46beff3f08fdb768bd67e78b8011`,
   lineage `472ef790-b249-45ec-817f-718005980d9e`, and serial `107`, and only when the
   current planning state is the same lineage at serial `108`. A schema-5 CompleteDark baseline
   may also advance by exactly one serial in the same lineage when its full document-to-migration-
   to-operator Git chain validates, the complete document-baseline-operator-to-current delta has
   an independent reviewed checksum, and the refresh-backed task plan remains limited to the
   exact migration task replacement after overlaying the verified live gateway artifact. This is
   the bounded handoff for a separately reviewed gateway apply; two or more serials, a different
   lineage, ParserDark, a missing review, or any extra plan change fail closed. Every other retained
   baseline must equal the current planning-state identity. The exact serial-107 plan predates the nine public-
   job-reader inputs. Only this checksum-pinned stale-state handoff may omit those names; the
   operator injects `deploy_public_job_reader = false`, residual acceptance `false`, empty boundary
   and artifact strings, and rate/burst limits `1`/`1`. Any other missing or extra variable fails
   closed, and the resulting plan must still contain only the migration task-definition
   replacement. This compatibility does not authorize the public reader or route.
   Pass the verifier's exact `BaselineMetadataSha256` as mandatory
   `-AppliedPlanMetadataSha256`; the operator checks those bytes before parsing the sidecar and
   cross-binds its stage and parser pin to the exact saved-plan variables. Retained, task-release,
   and post-migration plans accept only the same semantic, subset-safe provider-normalization
   records as the document-dark verifier, including the legacy forward-only RDS restore clock and
   migration-task null-to-empty tag records. They also admit a provider-observed S3 endpoint CIDR
   refresh only when valid unique IPv4 CIDRs grow by strict set addition, the prior set is retained,
   all other attributes equal the exact planned value, and sensitivity remains all false;
   duplicates, removals, unknowns, broadened policy semantics, or any other drift fail closed. The
   task plan rejects every meaningful change except a create-before-destroy replacement of
   `module.platform.aws_ecs_task_definition.migration[0]` caused only by the image digest. It also
   accepts the one state-only `module.platform.terraform_data.ingestion_activation_guard` create
   only when the retained state predates that guard; subsequent releases require the guard and its
   outputs to remain no-op. A created guard must have exactly `deploy = false`, `runtime = false`, and
   `synthetic_only = false`; it cannot deploy or activate ingestion. Any different action, input,
   unknown/sensitive shape, replacement path, additional resource, or output change fails closed.
2. Independently inspect the saved plan and its `.metadata.json` sidecar, then pass both printed
   SHA-256 values to `ApplyTask`. Task metadata binds the retained plan and sidecar paths/checksums,
   stage, the historical retained state identity, the exact current planning state identity,
   receipt, parser pin, retained release/operator identity, current operator identity, and
   baseline-to-current delta checksum in task-metadata schema 2. The apply requires
   the same reviewed delta argument used for planning and rederives it before rechecking that
   complete handoff against live state plus the artifact, plan semantics, encrypted state, task
   definition, empty cluster, and zero-service boundary. `ApplyTask` and every later task-plan
   consumer require `-ReviewedTaskPlanMetadataSha256` in addition to the reviewed plan SHA. A
   changed HEAD, planning-state lineage/serial, baseline sidecar, delta, or task metadata is a
   blocker. The source guard checks the explicit remote-tracking ref, Git command exits, index
   flags, every tracked Terraform-source byte, and every extra file below the Terraform source
   root; only regular untracked `.tfplan` artifacts are permitted outside `.terraform`.
3. `PlanExecution` resolves the exact applied task definition, two migration subnets, and one
   application security group into a JSON `run-task` request. Review its SHA-256. If an operator-
   only correction was merged after `ApplyTask`, the release SHA may be an ancestor of the clean
   current `main`; the descriptor binds both the applied release SHA and exact operator SHA. The
   request has count one, Fargate, public control-plane/image access, an idempotency token, and no
   `overrides` property.
4. `Execute` accepts only that checksum-reviewed descriptor, submits it through
   `--cli-input-json`, first conditionally creates an immutable customer-KMS execution claim in
   the versioned state bucket, writes a local receipt immediately, waits for `STOPPED`, and
   requires the exact image digest, exit code `0`, no effective override, seven aggregate-only
   success messages, zero active migration tasks, and zero ECS services.
5. `Verify` repeats the task/log/zero-compute checks and retains a refresh-backed zero-drift plan
   plus its adjacent `.baseline.json` sidecar. The operator rejects overwrites, removes only newly
   created plan/sidecar bytes if any validation or write fails, and requires state lineage/serial
   to remain unchanged while producing the handoff. It reconstructs the exact saved-plan input
   set against variable declarations across every root Terraform `*.tf` file and rejects missing,
   extra, or duplicate names. A schema-5 sidecar is also a valid next migration input: it preserves
   and revalidates the deployed document release, its original operator delta, the intervening
   migration release, and the later operator delta, then projects the original document binding
   into the next task metadata so the following verifier cannot collapse the historical chain.
   A newly emitted schema-5 sidecar preserves the deployed document release and its
   original operator delta separately from the checksum-reviewed migration release, reviewed
   baseline-to-release delta, and later verifier-only operator delta. It also binds the current Terraform variable inventory,
   account, region, state lineage/serial, document stage, parser-version pin, reviewed document-
   publication receipt, immutable migration-image digest, plan path/hash, Terraform `1.16.2`,
   nonapplyable shape, zero meaningful resource/output changes, and only the bounded provider
   refresh records. Retain the printed `BaselinePath`,
   `BaselineSha256`, `BaselineMetadataPath`, and `BaselineMetadataSha256` for the next separately
   reviewed `CompleteDark` or gateway release; do not substitute the consumed migration task plan.

If the local waiter exits after a durable claim and ECS submission, never call `Execute` again.
Use `Recover` with the exact submitted receipt and reviewed descriptor. It has no submission path;
it accepts only the exact claimed task already stopped with exit `0`, the seven aggregate success
records, and zero remaining migration compute, then finalizes the existing receipt for `Verify`.

Run `Get-Help` through the script's `-Help` switch for exact commands. Never reuse an execution
descriptor for a different task plan or image. The durable claim is never removed automatically,
so an ambiguous submission cannot become eligible for replay by deleting a local receipt or
waiting for the ECS client-token window to expire. Retain the receipt, inspect that exact task, and
do not generate a second descriptor or retry blindly.

## Execute once

Resolve the cluster, task-definition ARN, two reviewed migration subnets, and application security
group from Terraform outputs. Start exactly one Fargate task with a public IP only for bounded
control-plane/image access. Wait for `STOPPED`, require the `database-migration` container exit
code `0`, and retain only the sanitized success event.

Do not retry an unknown or failed migration blindly. Inspect the task stop reason and aggregate
logs, determine whether its transaction committed, and review a recovery migration when state is
ambiguous.

## Acceptance

- Every service-owned migration runner verifies its expected versions/checksums and schema
  invariants, and the orchestrator reports aggregate success only after all owners pass.
- No restricted value or candidate identifier appears in logs or evidence.
- Zero migration tasks remain running.
- API `200/200/401`, preference persistence, durable completion, and alarms remain healthy.
- The exact migration digest remains available for replay in the environment-local repository.
- A refresh-backed Terraform plan reports zero drift.

Packaging a Trust candidate-rights migration or validating this local boundary does not by itself
prove its deployed behavior or a deployed database restore. Keep Phase 2 synthetic
fixtures and activation switches default-dark until their separate acceptance gates pass.
