# Development Cloud Setup

This checklist separates product-owner/vendor-console work from repository deployment work. The
target is the dedicated development AWS account in `us-east-2`. Do not place credentials, API keys,
account IDs, tenant identifiers, or Terraform variable files in source control.

## Product-owner setup

### 1. Confirm account isolation

- Use a dedicated AWS development account. Do not deploy into a personal/shared workload account.
- Keep the AWS Organizations management account free of application workloads.
- Reserve a separate staging member account. Staging resources remain off until an on-demand
  rehearsal or release gate requires them.
- Protect root and account-recovery access, use MFA, and create no root access keys.
- Confirm billing and alternate security/operations contacts.

Stop before deployment until the product owner confirms which AWS account is the development
target.

### 2. Configure human AWS access

- Enable AWS IAM Identity Center.
- Assign the product owner a bootstrap administrator permission set in the development account.
  Use it only for state/OIDC bootstrap and reduce daily privileges after bootstrap.
- Require MFA.
- Do not create or share a long-lived IAM access key.
- Configure the local AWS CLI with temporary SSO credentials:

```powershell
aws configure sso --profile ai-job-apply-development-admin
aws sso login --profile ai-job-apply-development-admin
aws sts get-caller-identity `
  --profile ai-job-apply-development-admin `
  --region us-east-2
```

Confirm the command succeeds without pasting its account/user output into repository evidence.

### 3. Add cost guardrails

- Create a monthly AWS cost budget scoped to the development account.
- Use the Terraform-managed `$5` monthly actual-cost alert as an early warning. Revisit the amount
  using real billing evidence.
- Send alerts to an actively monitored owner address.

Budgets notify; they do not guarantee that services stop spending.

### 4. Install the pinned deployment tool

Use the approved portable deployment toolchain. The excluded GitHub Actions pin is unchanged:

```powershell
pwsh -NoProfile -File scripts/install-terraform-toolchain.ps1
. ./scripts/use-deployment-terraform.ps1
terraform version
```

The installer verifies signed checksums and keeps both versions below ignored `.tmp/toolchains`.
Dot-source the selector in each new operator shell; it changes only that process's PATH. Current
operations use 1.16.2; 1.9.8 is retained only for explicit historical-plan reads. Do not use the old
GitHub workflows for cloud planning or replace historical plans/receipts with new version labels.

### 5. Prepare GitHub environments

In `Vrixic/project-ai-job-apply`, create GitHub Environments named `development` and `staging`.
Do not add AWS access keys. After bootstrap, platform engineering supplies these non-secret
environment variables:

- `AWS_DEPLOY_ROLE_ARN`
- `TERRAFORM_STATE_BUCKET`

The development role trust is restricted to the `development` GitHub Environment. The staging
environment receives outputs only from its own future staging-account bootstrap.

After development bootstrap, add these repository Environment variables under
`Settings` → `Environments` → `development` → `Environment variables`:

- `AWS_DEPLOY_ROLE_ARN` — the `github_deploy_role_arn` bootstrap output;
- `TERRAFORM_STATE_BUCKET` — the `state_bucket` bootstrap output.

They are identifiers, not secrets. Restrict the environment's deployment branches and tags to the
`main` branch. Cloud-authenticated Terraform planning and OIDC conformance are manual-dispatch
workflows; pull requests run offline Terraform validation only.

### 6. Confirm the durable runtime boundary

No external workflow-provider account, namespace, API key, or runtime secret is required. The
supported path uses SQS/outbox recovery and versioned Lambda durable functions in the selected AWS
account. Treat any historical provider setup instruction as evidence only.

## Platform-engineering execution

After the product-owner setup is confirmed, platform engineering:

1. verifies the exact AWS caller/account/region and records only sanitized evidence;
2. validates Terraform 1.16.2, effective S3 state locking and repository checks;
3. bootstraps encrypted/versioned state and the GitHub OIDC deployment role;
4. configures GitHub Environment variables from bootstrap outputs;
5. applies network, KMS, RDS, S3, SQS/DLQ, the migration repository/task, Lambda durable runtime,
   logs, metrics, alarms, and managed secret destinations with the runtime disabled;
6. publishes immutable gateway/workflow Lambda artifacts and the scanned migration-only image;
7. runs the reviewed database migration through a
   [one-off controlled task](../../../runbooks/deployments/database-migration.md);
8. reviews and applies the exact saved serverless runtime plan;
9. proves gateway health, Auth0 access-token validation, owner isolation, database persistence,
   outbox dispatch, durable completion, structured/redacted logs, correlation identifiers,
   metrics, alarms, and failure recovery;
10. performs rollback and follows the
   [PostgreSQL point-in-time restore runbook](../../../runbooks/restore/development-postgresql-point-in-time.md);
    and
11. validates the isolated staging composition without continuous application compute.

No application apply proceeds with placeholders, mutable image tags, a local/test token issuer, or
an unreviewed Terraform plan.
