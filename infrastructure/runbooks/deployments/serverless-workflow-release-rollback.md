# Serverless Workflow Release Rollback

Use this procedure after two workflow releases in the selected environment have independently
passed protected publication, coordinated Terraform release, dark conformance, alert delivery,
and zero drift. The drill reverses the complete coupled release and restores it through separate
checksum-reviewed plans. It does not route traffic, enable replacement triggers, resume ECS, or
write product data.

## Preconditions

- Work from exact clean synchronized `main` with Terraform `1.9.8`.
- Refresh the selected environment's `ai-job-apply-<environment>-admin` IAM Identity Center
  session and verify its exact isolated account in `us-east-2`.
- Retain one reviewed Terraform plan containing the currently accepted workflow artifact inputs
  and one containing the earlier accepted rollback artifact inputs. Keep both below the
  selected environment's `.terraform` directory.
- Require gateway/outbox dispatch to remain `temporal`, the starter and EventBridge replacement
  triggers disabled, the durable DLQ empty, all seven workflow alarms `OK`, and both ECS rollback
  services retained idle at `0/0/0`.
- Never use the pre-correction workflow artifacts that failed Node.js initialization as a rollback
  target.

## Plan the reverse release

```powershell
aws sso login --profile ai-job-apply-staging-admin

.\scripts\operate-serverless-workflow-release-rollback.ps1 `
  -Environment staging `
  -Action PlanRollback `
  -ExpectedAccountId $environmentAccountId `
  -StateBucket $environmentStateBucket `
  -CurrentReleasePlanPath .terraform/workflow-dark-plans/CURRENT_ACCEPTED.tfplan `
  -RollbackReleasePlanPath .terraform/workflow-dark-plans/ROLLBACK_ACCEPTED.tfplan
```

The sanitized result must report zero creates/deletes, exactly 14 in-place updates, and exactly
one create-before-delete replacement of the policy-hash propagation gate. It must also report
disabled triggers, idle ECS, and no public-API traffic change. Review and separately authorize the
printed rollback-plan SHA-256. The plan and local recovery context are sensitive and ignored.

## Apply and prove the rollback release

```powershell
.\scripts\operate-serverless-workflow-release-rollback.ps1 `
  -Environment staging `
  -Action ApplyRollback `
  -ExpectedPlanSha256 "REVIEWED_ROLLBACK_SHA256" `
  -Execute
```

The operator proves the current release is zero drift, applies only the checksum-matched saved
plan, and proves the rollback release is zero drift. A partial failure stops without replanning or
automatic restoration; retain the context and perform a fresh read-only assessment.

Generate and execute a fresh context through
the selected environment's workflow dark-conformance wrapper. Require all four synthetic paths,
exact DLQ cleanup, both `OK → ALARM → OK` pairs, privacy-safe aggregate logs, disabled triggers,
idle ECS, unchanged routing, context cleanup, and post-run zero drift. Confirm receipt of all four
notifications before planning restoration.

## Plan and apply restoration

```powershell
.\scripts\operate-serverless-workflow-release-rollback.ps1 `
  -Environment staging `
  -Action PlanRestore `
  -ConfirmRollbackConformance

.\scripts\operate-serverless-workflow-release-rollback.ps1 `
  -Environment staging `
  -Action ApplyRestore `
  -ExpectedPlanSha256 "REVIEWED_RESTORE_SHA256" `
  -Execute
```

Review and authorize the restoration checksum separately. It must have the same exact action
boundary as the rollback plan and restore the original accepted artifact set to zero drift.
Repeat the complete dark-conformance and notification drill against the restored release.

## Cleanup

Only after restored-release conformance and notification delivery pass:

```powershell
.\scripts\operate-serverless-workflow-release-rollback.ps1 `
  -Environment staging `
  -Action Cleanup `
  -ConfirmRestoreConformance `
  -Execute
```

Cleanup re-proves restored zero drift and removes only this operator's ignored context, two
immutable endpoint snapshots, and reverse/forward saved plans. It makes no AWS change. Retain sanitized evidence containing source commits,
plan checksums, action counts, conformance results, notification confirmation, and zero-drift
results—never state, raw plans, object versions, account identifiers, credentials, payloads, raw
logs, or notification destinations/content.
