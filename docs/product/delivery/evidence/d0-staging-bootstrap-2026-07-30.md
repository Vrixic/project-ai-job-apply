# D0 Staging Bootstrap Evidence — 2026-07-30

## Scope

This record covers only the isolated staging-account Terraform bootstrap in AWS `us-east-2`.
It does not prove GitHub-originated staging OIDC conformance, the persistent platform,
applications, managed runtime secrets, Auth0/Temporal staging configuration, observability,
restore, workload baselines, or Phase 0 completion.

## Reproducible bootstrap correction

The committed bootstrap root declares the encrypted S3 backend that must eventually hold its
state, but that backend does not exist before the first apply. Reusing development Terraform
metadata would violate environment isolation. [PR #35](https://github.com/Vrixic/project-ai-job-apply/pull/35)
added an isolated local-backend workspace helper and template without changing any bootstrap
resource address. Its quality, integration, container, dependency-audit, Semgrep, and Terraform
validation checks passed before merge.

## Reviewed execution

- Source commit: `a9863eb2bf944258e963fd2fb9f3221fa70a0613`.
- Caller: temporary AWS IAM Identity Center administrator session in the dedicated staging
  account; no long-lived IAM access key was used.
- Terraform: `1.9.8`.
- Development/staging account inequality and absence of conflicting staging bootstrap resources:
  passed.
- Saved-plan SHA-256:
  `4D5EA4F4178C9C0225D85F95ACB53D01542E1879F67F168485A2F105C2E8D848`.
- Reviewed actions: 12 creates, 0 updates, 0 replacements, 0 deletions.
- Apply result: 12 added, 0 changed, 0 destroyed.
- Immediate refresh-backed remote-state plan result: no changes.

## Live controls verified

- The state bucket blocks every public-access mode and has versioning enabled.
- Default state encryption uses the expected customer-managed KMS key.
- The customer-managed state key has automatic rotation enabled.
- The GitHub OIDC provider has the exact token-service URL and `sts.amazonaws.com` audience.
- The deployment-role trust allows only `sts:AssumeRoleWithWebIdentity` from the exact immutable
  repository subject and `staging` GitHub Environment.
- The deployment role has its environment-specific permissions boundary and inline deployment
  policy.
- The environment-specific workload permissions boundary exists.

No account number, bucket name, role ARN, state content, credential, or token is retained in this
evidence.

## State migration and recovery

Active bootstrap state was migrated from the isolated local workspace into the private,
versioned, KMS-encrypted S3 backend under `bootstrap.tfstate`. The active object is reachable,
uses the expected key, and contains all 12 managed resources. A separately named pre-migration
recovery object was uploaded with the same KMS key and verified against its SHA-256 checksum and
content length.

Terraform left local recovery copies in the isolated, ignored operator workspace. They contain
cloud metadata but no provider credentials or application secrets. Removal from that workspace
remains an operator cleanup action after the encrypted recovery object is accepted.

## GitHub environment handoff

The GitHub `staging` Environment now contains exactly the non-secret
`AWS_DEPLOY_ROLE_ARN` and `TERRAFORM_STATE_BUCKET` variables resolved from encrypted staging state.
Their values were not printed or copied into source or evidence. The merged
[staging AWS OIDC conformance](d0-staging-aws-oidc-conformance-2026-07-30.md) subsequently proved
short-lived role assumption and encrypted state access for both isolated environments.

## Remaining staging acceptance

- The [applications-disabled persistent staging platform](d0-staging-persistent-platform-2026-07-30.md)
  now passes its exact apply, live-control audit, and no-drift checks.
- Configure staging-only Auth0 and Temporal, publish immutable images, migrate, and activate the
  application.
- Replay the applicable identity, ownership, workflow, observability, restart, restore, workload,
  and cost-attribution matrix.
- Record no drift and return staging to its reviewed lean posture when acceptance finishes.
