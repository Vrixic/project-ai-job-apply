# Workload Deployment

This placeholder will contain workload deployment definitions after an ADR selects ECS or Kubernetes for each runtime class.

## Planned subfolders

- `base/` — Shared service, worker, network, and health configuration.
- `environments/` — Environment overlays or task/service definitions.
- `services/` — API and domain-service workloads.
- `workers/` — Queue, AI, ATS, and messaging workers.
- `browser-runners/` — Highly isolated automation workloads.
- `jobs/` — Migrations, reconciliation, and scheduled maintenance.

Do not maintain parallel ECS and Kubernetes implementations without an explicit reason; the final folder name may be changed after the deployment ADR.
