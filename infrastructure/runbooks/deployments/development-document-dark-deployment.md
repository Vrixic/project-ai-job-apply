# Development document-processing dark deployment

This operator deploys the resume coordinator and isolated parser into development without
allowing any candidate document to flow through them. It is intentionally separate from artifact
publication and database migration.

## Required reviewed inputs

- a clean `main` checkout exactly matching `origin/main`;
- the exact development IAM Identity Center account in `us-east-2`;
- the environment's private, versioned, customer-KMS Terraform state bucket;
- a saved Terraform `1.9.8` baseline whose reviewed checksum is supplied and whose plan has zero
  changes;
- a `verified` document publication receipt and its reviewed checksum.

The receipt must bind eight exact-version S3 objects—ZIP, SBOM, manifest, and checksum for both
Lambdas—to merged source, the Terraform-owned artifact bucket, and the platform KMS key. The
operator independently reads those exact versions before planning or applying.

## Structural boundary

The plan may contain exactly 39 creates and six in-place updates. Creates are limited to the
document queues and policies, EventBridge rules and targets, three bounded IAM roles and inline
policies, parser security group, S3/STS endpoints, two immutable Lambda functions and aliases,
the disabled queue mapping, reconciler permission, three log metrics, and eight alarms. Updates
are limited to the platform KMS key policy, candidate-document bucket policy, operational SNS
policy, and the existing Lambda, Secrets Manager, and SQS endpoint policies.

No existing resource may be deleted or replaced. The GuardDuty scan-result rule, SQS mapping, and
reconciler are forced disabled. The two security-health EventBridge rules remain enabled so a
GuardDuty protection-plan failure can alert even while processing is dark.

Each of the six updates is also checked semantically. Every prior statement must remain unchanged;
only the exact document EventBridge KMS grants, clean-tag quarantine deny, health-alert SNS grant,
processor-only SQS endpoint grant, immutable-parser Lambda endpoint grant, and processor addition
to the existing database-secret endpoint condition are permitted. Unknown or sensitive policy
results, broader actions/resources/principals, and changes outside each policy attribute fail.

The processor uses the exact already accepted, versioned AWS Parameters and Secrets extension
layer. The isolated parser has no layer and no database runtime.

## Plan and apply

```powershell
.\scripts\operate-development-document-dark-deployment.ps1 -Action Plan `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -BaselinePlanPath ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
  -PublicationReceiptPath VERIFIED_RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256
```

Review the saved plan and reported checksum. Apply those exact bytes:

```powershell
.\scripts\operate-development-document-dark-deployment.ps1 -Action Apply `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -BaselinePlanPath ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
  -PublicationReceiptPath VERIFIED_RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256 `
  -PlanPath PLAN_PATH_FROM_PLAN -ReviewedPlanSha256 PLAN_SHA256
```

Apply repeats every checksum, receipt, variable-overlay, and structural-plan check before changing
AWS. It then verifies immutable aliases and code hashes, permissions boundaries, five private
endpoints, three empty encrypted queues, disabled processing triggers, enabled security-health
rules and exact retry/DLQ targets, exact queue policies, eight actionable `OK` alarms, and a
refresh-backed zero-change plan. Lambda verification requires an `Active`/`Successful` immutable
release with the exact runtime, handler, architecture, timeout, concurrency, role, VPC, environment,
tracing, and logging boundary. The parser additionally must retain its no-secret, no-shared-log,
no-active-tracing, S3-and-DNS-only isolation.

Run the same live and zero-drift proof later without applying:

```powershell
.\scripts\operate-development-document-dark-deployment.ps1 -Action Verify `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -BaselinePlanPath ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
  -PublicationReceiptPath VERIFIED_RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256
```

Do not enable either trigger with this operator. Trigger activation requires separate synthetic
conformance and separately reviewed plans.
