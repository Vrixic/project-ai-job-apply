# Terraform

Defines persistent cloud resources, identity, networking, storage, databases, queues, encryption, and environment composition.

## Planned subfolders

- `modules/` — Reusable narrowly scoped infrastructure modules.
- `environments/` — Development, staging, and production composition.
- `bootstrap/` — State backend and initial identity setup.
- `policies/` — IAM and security policies.
- `tests/` — Validation, policy, plan, and drift checks.

State and secrets remain in managed backends. Modules expose explicit inputs/outputs and default to least privilege and multi-AZ resilience.
