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

The private repository uses a full-lockfile pnpm audit and a repository-local Semgrep gate with a
pinned scanner and pinned upstream rules. GitHub Dependency Review and CodeQL uploads are not
claimed because GitHub code-security services are not enabled for this repository.
