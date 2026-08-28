# Bootstrap workload-boundary operator

Use `scripts/operate-bootstrap-workload-boundary.ps1` for the narrowly approved bootstrap
workload-boundary change set. The current `candidate-rights-storage-v1` change set preserves the
owned document-object role boundary and permits only the candidate-rights S3 operations already
granted by the workload roles. The operator supports `development` and `staging`, but one execution
may target only one exact account and its own `bootstrap.tfstate`.

## Safety boundary

The operator requires Terraform `1.9.8`, `us-east-2`, a temporary IAM Identity Center caller, a
clean `main` checkout identical to `origin/main`, an account-matching encrypted/versioned/private
state bucket, and matching remote-state outputs. A generated plan is accepted only when it updates
`aws_iam_policy.workload_boundary` in place and adds exactly these environment-scoped permissions:

```text
candidate export object read/write/exact-version deletion under candidate-data-exports/*
candidate deletion recovery list/read/write/retention under candidate-deletion-recovery/*
candidate document ListBucketVersions for exact-version deletion
```

Every pre-existing policy statement except the exact candidate-document list action must remain
semantically unchanged. The existing owned-role assumption must remain exact. IAM Access Analyzer
must return no error or security-warning finding. Plan files and metadata stay beneath the ignored
bootstrap `.terraform/bootstrap-workload-boundary/<environment>` directory.

## Plan, review, and apply

Refresh the selected SSO session, replace the placeholders with the exact environment account and
state bucket, and create a refresh-backed saved plan:

```powershell
.\scripts\operate-bootstrap-workload-boundary.ps1 -Action Plan `
  -Environment development `
  -AwsProfile ai-job-apply-development-admin `
  -ExpectedAccountId ACCOUNT_ID `
  -StateBucket STATE_BUCKET
```

Review the reported one-resource semantic delta and retain its exact `PlanPath` and `PlanSha256`.
Apply that reviewed file without regenerating it:

```powershell
.\scripts\operate-bootstrap-workload-boundary.ps1 -Action Apply `
  -Environment development `
  -AwsProfile ai-job-apply-development-admin `
  -ExpectedAccountId ACCOUNT_ID `
  -StateBucket STATE_BUCKET `
  -PlanPath PLAN_PATH `
  -ReviewedPlanSha256 PLAN_SHA256
```

Apply rechecks account, source commit, checksum, sidecar metadata, and plan semantics. It then runs
the same verification used by the read-only action:

```powershell
.\scripts\operate-bootstrap-workload-boundary.ps1 -Action Verify `
  -Environment development `
  -AwsProfile ai-job-apply-development-admin `
  -ExpectedAccountId ACCOUNT_ID `
  -StateBucket STATE_BUCKET
```

Verification requires a zero-change refresh-backed plan and semantic equality between the live IAM
managed-policy default version and Terraform state. Stop on any mismatch; do not regenerate and
apply a different plan under an existing approval.
