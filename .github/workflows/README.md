# GitHub Workflows

This folder will hold CI/CD workflows for validation and controlled delivery.

## Planned workflow groups

- Pull-request quality: formatting, linting, type checks, unit tests, and contract checks.
- Security: secret, dependency, SAST, IaC, container, and license scanning.
- Integration: database, workflow, API, extension, and ATS-fixture tests.
- Preview: isolated web/admin and backend preview environments.
- Release: signed artifacts, migrations, canaries, mobile builds, and extension publishing.
- Scheduled: dependency checks, drift detection, restore exercises, and synthetic monitoring.

Workflows must use short-lived cloud identity where possible and must not print secrets or user data.

`aws-oidc-conformance.yml` is a manual identity check for both isolated GitHub Environments. Each
matrix job resolves only that environment's deployment-role and state-bucket variables, exchanges
GitHub's OIDC token for short-lived AWS credentials, verifies the exact role/account relationship,
and proves read-only access to its encrypted `bootstrap.tfstate`.

The private repository uses a full-lockfile pnpm audit and a repository-local Semgrep gate with a
pinned scanner and pinned upstream rules. GitHub Dependency Review and CodeQL uploads are not
claimed because GitHub code-security services are not enabled for this repository.

`publish-environment-images.yml` is a manual, `main`-only release workflow with an explicit
`development` or `staging` input. Each job assumes only the selected GitHub Environment through
OIDC, verifies that environment's ECR repositories remain immutable, KMS-encrypted, and
scan-on-push, publishes gateway and worker images under the exact source commit, waits for ECR
scanning, and blocks use of images with high or critical findings. Build caches and summaries are
environment scoped. Its digest-bearing job summaries are deployment evidence; publishing an image
does not enable an ECS service.
