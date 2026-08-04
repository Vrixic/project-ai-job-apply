# Development Serverless Workflow Artifact Release

Use this procedure to replace the three immutable development workflow artifacts after the
complete workflow boundary is deployed dark. The release must not enable the SQS or EventBridge
triggers, move API traffic, alter ECS rollback capacity, or change gateway dispatch from Temporal.

## Safety boundary

- Run only from exact, clean, synchronized `main` with Terraform `1.9.8` and a temporary
  development IAM Identity Center session in `us-east-2`.
- Select exact current-version S3 objects from a successful protected publication run. Require
  source/digest metadata, a manifest and bundle marker bound to the exact source commit, full-object
  SHA-256, versioning, customer-KMS encryption, and bucket keys.
- Require the five current workflow aliases and functions to be healthy and immutable, the four
  database-facing functions to retain the pinned regional Secrets extension, and all reserved
  concurrency limits to remain bounded.
- Require the starter mapping and both EventBridge rules to remain disabled, all seven workflow
  alarms to be enabled and `OK`, the durable DLQ to be empty, and the durable stack to be complete.
- Require API Gateway to remain an HTTP proxy through Cloud Map, both ECS rollback services to be
  retained together at the accepted `0/0/0` idle posture (or together at `1/1/0` only under an
  explicitly reviewed resume), and gateway dispatch to remain `temporal`.
- Apply only the exact saved plan whose SHA-256 the product owner explicitly authorizes. Never
  replan inside the apply step.

## Generate and review

Synchronize `main`, refresh the development SSO session, export short-lived credentials for the
Terraform S3 backend, and reconstruct the existing gateway artifact inputs from encrypted remote
state. Obtain the new workflow keys, object versions, hexadecimal/base64 checksums, and source
commit from the protected publication record without copying credentials or state into source.

Run the planner with those exact values:

```powershell
.\scripts\plan-development-serverless-workflow-dark.ps1 `
  -ExpectedAccountId $releaseAccountId `
  -StateBucket $releaseStateBucket `
  -GatewayArtifactS3Key $currentGatewayKey `
  -GatewayArtifactS3ObjectVersion $currentGatewayVersion `
  -GatewayArtifactSourceSha $currentGatewaySource `
  -GatewayArtifactSha256 $currentGatewayHexSha256 `
  -GatewayArtifactBase64Sha256 $currentGatewayBase64Sha256 `
  -WorkflowArtifactSourceSha $newWorkflowSource `
  -WorkflowIngressArtifactS3Key $newIngressKey `
  -WorkflowIngressArtifactS3ObjectVersion $newIngressVersion `
  -WorkflowIngressArtifactSha256 $newIngressHexSha256 `
  -WorkflowIngressArtifactBase64Sha256 $newIngressBase64Sha256 `
  -DurableArtifactS3Key $newDurableKey `
  -DurableArtifactS3ObjectVersion $newDurableVersion `
  -DurableArtifactSha256 $newDurableHexSha256 `
  -DurableArtifactBase64Sha256 $newDurableBase64Sha256 `
  -ActivityArtifactS3Key $newActivityKey `
  -ActivityArtifactS3ObjectVersion $newActivityVersion `
  -ActivityArtifactSha256 $newActivityHexSha256 `
  -ActivityArtifactBase64Sha256 $newActivityBase64Sha256 `
  -PinnedExtensionLayerArn $currentPinnedExtensionLayer `
  -AllowArtifactReleaseUpdate
```

The sanitized result must report exactly:

| Action | Count |
|---|---:|
| Create | 0 |
| Update in place | 14 |
| Delete | 0 |
| Create-before-delete replacement | 1 |

The updates are limited to four Terraform-managed functions, their four immutable aliases, the
durable CloudFormation stack, the disabled terminal event pattern, and four version-scoped policy
documents. The one replacement is only Terraform's policy-hash-keyed 45-second `time_sleep`
propagation gate; its replacement must preserve the role and duration and change only the policy
hash. The durable stack publishes and retains the new durable version and advances its unweighted
development alias. Any other action invalidates the plan.

The plan is sensitive and remains under the ignored development `.terraform` directory. Record
only its SHA-256 and sanitized summary. A diagnostic created from unmerged or dirty operator source
must never be authorized.

## Apply an explicitly authorized plan

After the plan is regenerated from clean merged `main`, review the exact checksum and receive an
explicit authorization naming that SHA-256. Immediately before apply, recheck the commit, clean
worktree, development caller, plan path, and checksum. Export only short-lived SSO credentials,
set `TF_DATA_DIR` to the same ignored provider directory used for planning, then apply the saved
file directly:

```powershell
$actualPlanSha256 = (Get-FileHash -LiteralPath $reviewedPlanPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualPlanSha256 -ne $authorizedPlanSha256.ToLowerInvariant()) {
  throw "The saved plan does not match the authorized checksum."
}

terraform -chdir=infrastructure/terraform/environments/development apply `
  -input=false `
  $reviewedPlanPath
```

Do not use `-target`, apply a regenerated plan, or continue after any partial failure. A failure
must retain disabled triggers and ECS/API rollback capacity, then receive a new read-only state
assessment and separately reviewed recovery plan.

## Verify and continue

After a successful apply:

1. Re-run the planner from the same exact inputs with `-VerifyCompletedDarkDeployment`; require
   zero creates, updates, deletes, and replacements.
2. Recheck all five exact aliases/functions, bounded concurrency, disabled triggers, seven `OK`
   alarms, empty DLQ, complete durable stack, stable ECS services, unchanged API integration, and
   Temporal gateway dispatch.
3. Generate a fresh dark-conformance context. Execute it only after separate authorization of its
   exact checksum, then inspect aggregate logs and alarms without retaining raw payloads.
4. Exercise a separately reviewed release rollback between known-good retained versions before
   any workflow trigger cutover.

If conformance fails, do not enable a trigger. Rollback must use a separately reviewed reverse
Terraform plan so functions, aliases, durable version references, event patterns, and IAM/queue/
endpoint policies return to one internally consistent artifact set.
