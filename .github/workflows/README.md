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

The private repository uses the centralized `pnpm audit:dependencies` full-lockfile audit and a
repository-local Semgrep gate with a pinned scanner and pinned upstream rules. The audit fails at
High severity except for the two exact, expiring, path-constrained Expo/Metro `image-size`
exceptions recorded in the [dependency exception register](../../docs/security/dependency-vulnerability-exceptions.md).
It rejects changed paths/versions, stale exceptions, and every unlisted advisory. GitHub Dependency
Review and CodeQL uploads are not claimed because GitHub code-security services are not enabled for
this repository.

`publish-environment-images.yml` is a manual, `main`-only database-migration artifact workflow with
an explicit `development` or `staging` input. It assumes only the selected GitHub Environment,
verifies `ai-job-apply/migration` remains immutable, KMS-encrypted, and scan-on-push, publishes
`Dockerfile.migration` under the exact source commit, waits for scanning, and rejects High or
Critical findings. Its digest-bearing summary is deployment evidence; publishing does not create
or run a Fargate task.

`publish-gateway-lambda.yml` is the corresponding manual, `main`-only scale-to-zero artifact
workflow. It tests and audits the gateway, proves two builds have the same ZIP digest, validates
the CycloneDX SBOM, verifies the selected environment's artifact bucket remains private,
versioned, and KMS encrypted, and writes the ZIP plus evidence under a source-and-digest-bound key.
It refuses to create another object version at an existing release key and prints only the exact
sanitized Terraform inputs. Publishing does not create a Lambda or change API traffic.

`publish-document-lambdas.yml` publishes the D1 document coordinator and isolated parser as two
immutable, source-and-digest-bound artifacts. It runs focused tests and dependency audit, proves
reproducible ZIPs, validates separate SBOMs, and uploads only to the selected private versioned KMS
artifact bucket. It verifies all four S3 public-access blocks before publication, then reads the
exact uploaded object version back to prove its KMS mode, checksum, source commit, and artifact
digest metadata. Publication does not create functions or enable GuardDuty result consumption.
