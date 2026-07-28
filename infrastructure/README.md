# Infrastructure

Contains infrastructure-as-code, deployment configuration, observability definitions, and operational runbooks required to run the Platform safely.

## Subfolders

- `terraform/` — Cloud resources and environment composition.
- `kubernetes-or-ecs/` — Workload deployment definitions once the runtime is selected.
- `observability/` — Dashboards, alerts, SLOs, and synthetic checks as code.
- `runbooks/` — Incident, restore, and provider-failure procedures.

Persistent infrastructure changes are reviewed, reproducible, and tested in a non-production environment before production.
