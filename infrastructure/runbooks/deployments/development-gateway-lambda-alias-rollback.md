# Development Gateway Lambda Alias Rollback

This procedure proves that the unrouted development gateway alias can move from the current
accepted immutable release to the prior accepted identity-safe release and return without changing
public traffic. API Gateway remains routed to ECS for the complete drill.

## Safety boundary

- Use only the development IAM Identity Center profile in `us-east-2`.
- The rollback target must be version `2` or newer; version `1` contains the known identity defect
  and is structurally rejected.
- Both versions must be active, immutable Node.js 24 releases with identical runtime, role, KMS,
  VPC, layer, tracing, resource, and non-release environment configuration.
- The alias must be unweighted and the tracked function must still match the current alias with
  reserved concurrency `2`.
- The AWS alias revision ID and ignored recovery-context checksum are both required at execution.
- The operator changes only the dark alias twice. It does not modify Terraform, the function,
  API Gateway integrations/routes, ECS, RDS, IAM, KMS, networking, queues, secrets, or alarms.
- The prior version is smoke-tested and the current version is restored in `finally`. Public users
  continue reaching ECS even if the dark drill fails.

## Prepare the reviewed context

From exact merged `main`, refresh development SSO and run:

```powershell
.\scripts\operate-development-gateway-lambda-alias-rollback.ps1 `
  -Action Plan `
  -RollbackVersion 2
```

The read-only action runs the full dark preflight, inspects the two immutable versions, and writes
one ignored recovery context under the development Terraform data directory. Review the printed
current version, rollback version, two planned alias updates, zero public-traffic change, and
SHA-256. Do not execute a context whose versions or checksum differ from the review.

## Execute and restore

After explicit authorization of that exact checksum:

```powershell
.\scripts\operate-development-gateway-lambda-alias-rollback.ps1 `
  -Action Execute `
  -ExpectedPlanSha256 "REVIEWED_SHA256" `
  -Execute
```

The operator revalidates all plan inputs, updates the alias through its reviewed revision ID,
requires the guarded bridge to return `200/200/401` on the rollback version, and restores the
current version in `finally`. It then requires the same bridge result, complete dark/ECS/API
preflight, and exact alias restoration before removing the ignored context.

After success, run the completed-dark Terraform verifier for the current immutable artifact and
require zero creates, updates, deletes, replacements, or traffic changes. Inspect all three Lambda
alarms and recent privacy-safe error aggregates before recording evidence.

## Recovery and cleanup

If execution stops before changing the alias, the reviewed context can be retained for diagnosis
or removed after verifying the alias is still on the current version:

```powershell
.\scripts\operate-development-gateway-lambda-alias-rollback.ps1 `
  -Action Cleanup `
  -ExpectedPlanSha256 "REVIEWED_SHA256" `
  -Execute
```

If restoration reports failure, do not improvise an alias update. Public traffic remains on ECS.
Inspect the exact alias version and revision, preserve the context, and prepare a separately
reviewed recovery using the current immutable version recorded in that context.
