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
- Start with a USD 75 budget and actual alerts at 50%, 80%, and 100%, plus a forecast alert at
  100%. Revisit the amount using real billing evidence.
- Send alerts to an actively monitored owner address.

Budgets notify; they do not guarantee that services stop spending.

### 4. Install the pinned deployment tool

Terraform must match CI:

```powershell
winget install --id Hashicorp.Terraform --exact --version 1.9.8
terraform version
```

Open a new PowerShell session if the executable is not immediately found.

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

### 6. Create Temporal Cloud development identity

- Create a Temporal Cloud account directly.
- Create namespace name `ai-job-apply-development`.
- Select AWS and `us-east-2` if offered; otherwise select the closest available US AWS region and
  record the choice.
- Use a seven-day development retention period and API-key authentication.
- Enable namespace deletion protection when available.
- Create a namespace-scoped Service Account for the worker with `Write` namespace permission,
  not Namespace Admin.
- Do not generate its API key until platform engineering has created the destination AWS Secrets
  Manager secret. At that handoff, generate a dedicated expiring API key, paste it directly into
  the AWS secret, clear the clipboard, and plan regular rotation.

The safe handoff to platform engineering contains only:

- full Namespace ID, such as `ai-job-apply-development.ACCOUNT_SUFFIX`;
- gRPC Namespace endpoint ending in `.tmprl.cloud:7233`; and
- selected Temporal Cloud provider region.

The API key is entered directly into the AWS Secrets Manager secret created during deployment.

## Platform-engineering execution

After the product-owner setup is confirmed, platform engineering:

1. verifies the exact AWS caller/account/region and records only sanitized evidence;
2. validates Terraform 1.9.8 and repository checks;
3. bootstraps encrypted/versioned state and the GitHub OIDC deployment role;
4. configures GitHub Environment variables from bootstrap outputs;
5. applies network, KMS, RDS, S3, SQS/DLQ, ECR, ECS, logs, metrics, alarms, and runtime secret
   containers with `deploy_applications = false`;
6. stores the Temporal API key directly in AWS Secrets Manager;
7. builds, tests, scans, and pushes immutable gateway and worker images;
8. runs the reviewed database migration through a one-off controlled task;
9. reviews and applies the exact saved application-enablement plan;
10. proves gateway health, Auth0 access-token validation, owner isolation, database persistence,
    outbox dispatch, Temporal completion, structured/redacted logs, correlation identifiers,
    metrics, alarms, and failure recovery;
11. performs rollback and PostgreSQL snapshot/point-in-time restore testing; and
12. validates the isolated staging composition without leaving staging continuously provisioned.

No application apply proceeds with placeholders, mutable image tags, a local/test token issuer, or
an unreviewed Terraform plan.
