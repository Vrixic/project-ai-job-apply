# D0 AWS OIDC Conformance Evidence — 2026-07-29

## Scope

This record proves GitHub Actions federation into the dedicated AWS development account and
read-only reachability of the encrypted bootstrap state from the environment-scoped deployment
role. It does not prove persistent-platform deployment, application deployment, deployed
observability, database restore, staging rehearsal, or Phase 0 completion.

## Source and target

- GitHub pull request [#1](https://github.com/Vrixic/project-ai-job-apply/pull/1) merged to `main`.
- Merge commit: `057632a45efb5846ba2a754d455f3aaf9298c982`.
- GitHub Environment: `development`.
- AWS region: `us-east-2`.
- Authentication: GitHub-issued OIDC token exchanged for short-lived AWS credentials; no AWS
  access key was stored in GitHub.

## Initial failure and diagnosis

The first manual
[conformance run](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30484198955)
received a GitHub OIDC token but AWS rejected `sts:AssumeRoleWithWebIdentity`. The repository was
created after GitHub introduced immutable default OIDC repository subjects. Its actual subject
prefix contains stable owner and repository IDs, while the deployed AWS role still trusted the
legacy name-only prefix.

The live role continued to require the exact `development` environment and
`sts.amazonaws.com` audience. The correction did not add a wildcard or broaden the trusted
repository, branch, environment, audience, principal, or role permissions.

## Reviewed correction

- Terraform plan: `0` to add, `1` to change, `0` to destroy.
- Only changed resource: `aws_iam_role.github_deploy`, updated in place.
- Only material policy change: legacy repository-name subject replaced by the immutable
  owner-ID/repository-ID subject for the exact `development` environment.
- Saved-plan SHA-256:
  `49171741B25E36634057CAB697183CBE9DE0E5BD065F0D261728A0430B2F5079`.
- Apply result: `0` added, `1` changed, `0` destroyed.
- Immediate refresh-backed plan: no changes.

Identifiers are intentionally omitted from this record beyond the immutable source commit and
saved-plan hash. The Terraform source contains the public GitHub subject prefix needed to
reproduce the trust policy.

## Successful conformance

The second manual
[conformance run](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30484690528)
completed successfully on merge commit `057632a45efb5846ba2a754d455f3aaf9298c982`:

- required GitHub Environment variables were present;
- AWS issued short-lived credentials for the exact development deployment role;
- the actual assumed-role identity matched the expected account and role; and
- the role could read metadata for the KMS-encrypted `bootstrap.tfstate` object.

## Remaining acceptance

- Merge the immutable-subject Terraform correction so source and deployed state remain aligned.
- Produce, review, and apply the persistent-platform plan with applications disabled.
- Deploy and prove application health, managed secrets, logs, metrics, traces, alarms, queues,
  migrations, rollback, and PostgreSQL restore.
- Retain staging as isolated, reproducibly provisionable, on-demand composition.
