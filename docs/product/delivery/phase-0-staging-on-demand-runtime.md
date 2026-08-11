# D0-017 — On-Demand Synthetic Staging Runtime

- Status: In progress
- Start: 2026-08-10
- Completion: Not completed
- Owner: Platform engineering
- Parent delivery: [Phase 0 foundation](phase-0-foundation.md)
- Decision: [ADR-018](../../adr/018-disposable-prelaunch-staging-data-plane.md)

## Objective

Use development as the continuous prelaunch integration environment and make isolated synthetic
staging genuinely on demand. Dormant staging must remove its hourly RDS and interface-endpoint cost
without weakening reproducibility, account isolation, encryption, migration safety, evidence, or
checksum-reviewed change control.

## Accepted lifecycle

```text
dormant --create dark data plane--> active --migrate/conform/release--> active with traffic
   ^                                                               |
   |                                                               v
   +--------- destroy synthetic data plane <-- quiesced <----------+
```

- `active`: PostgreSQL and three private service endpoints exist; RDS deletion protection is on.
- `quiesced`: routes/triggers are off, queues are empty, RDS remains, deletion protection is off.
- `dormant`: RDS and endpoints are absent; the inexpensive isolated control plane remains.

Staging contains synthetic data only. Dormancy intentionally creates no final database snapshot.
Every activation reruns migrations and creates Phase 0 profile/workflow records only through the
approved disposable Auth0/API conformance boundary; capability-owned fixture loaders may be used
only when they have an explicit approved seed contract. Selected release/restore/security acceptance
still completes before traffic is enabled.

## Task register

| ID | Task | State | Evidence or notes |
|---|---|---|---|
| SD-001 | Accept the disposable staging data-plane decision and retained-resource boundary. | Complete | Product owner approved development-first/on-demand staging on 2026-08-10. [ADR-018](../../adr/018-disposable-prelaunch-staging-data-plane.md) |
| SD-002 | Implement the Terraform state machine, cross-variable invariants, guarded checksum operator, tests, and runbook. | Complete | Merged [PR #195](https://github.com/Vrixic/project-ai-job-apply/pull/195) and the fail-closed plan-path/action correction in [PR #196](https://github.com/Vrixic/project-ai-job-apply/pull/196). PowerShell parsing/help, `git diff --check`, and full local `pnpm check` pass. [First-shutdown evidence](evidence/d0-staging-on-demand-first-shutdown-2026-08-10.md) |
| SD-003 | Apply `active -> quiesced -> dormant` through two separately reviewed plans and prove RDS/endpoints are absent while retained controls remain. | Complete | The exact seven-change quiescence and eight-delete/one-dashboard-update dormancy plans were separately checksum-approved and applied. Final status has no RDS, endpoints, routes, triggers, or queued work; retained-state inventory passes. [First-shutdown evidence](evidence/d0-staging-on-demand-first-shutdown-2026-08-10.md) |
| SD-004 | Recreate dark staging from the dormant plan, migrate, create synthetic conformance data through owned boundaries, release exact artifacts, and replay the required acceptance boundary. | Complete | Dark recreation, migration through `0003_retire_legacy_dispatch`, exact traffic release, persistence, durable readiness, two-account denial, 500/500 public probes, 25/25 workflows, AWS log/alarm/queue corroboration, and zero drift pass. [Reactivation acceptance](evidence/d0-staging-on-demand-reactivation-acceptance-2026-08-10.md) |
| SD-005 | Return staging to dormant after the activation drill and record the first complete dormant cost window. | In progress | The separately approved traffic-disable, quiescence, and destructive dormancy transitions pass. Final live status and 119-resource retained inventory pass with zero disposable resources. A fail-closed account-scoped inspector is ready; run it after AWS posts the first complete dormant UTC day and require zero RDS instance-hours and VPC endpoint-hours. [Reactivation acceptance](evidence/d0-staging-on-demand-reactivation-acceptance-2026-08-10.md), [updated exit readiness](evidence/d0-exit-review-readiness-2026-08-11.md) |

## Acceptance

- [x] Invalid lifecycle combinations fail during Terraform planning.
- [x] A direct active-to-dormant transition is rejected by the operator.
- [x] Quiescence disables all public runtime routes/triggers, drains queues, and removes only RDS
  deletion protection.
- [x] Dormancy deletes exactly the approved disposable resources and retains account/state,
  encryption, artifacts, identity, queues/DLQs, logs, alerts, and cost controls.
- [x] Dark activation deletes nothing and restores encrypted private PostgreSQL plus exactly three
  required interface endpoints.
- [x] Migration, synthetic conformance-data creation, persistence/readiness, durable workflow, idempotent replay,
  two-account denial, aggregate workload, logs/alarms, and zero drift pass after activation.
- [x] Staging returns to dormant after testing.
- [ ] A posted complete dormant interval corroborates the removed RDS/interface-endpoint costs.

## Work log

| Date | Update | Evidence |
|---|---|---|
| 2026-08-11 | Added a read-only, explicit complete-day dormant verification mode to the account-scoped cost inspector. It correctly rejected the known transition day after detecting 20.2028 RDS instance-hours and 61 VPC endpoint-hours, proving the usage-type boundary and fail-closed result. Retained control-plane cost may remain nonzero. The first eligible UTC interval is `2026-08-11` through `2026-08-12` after AWS posting. | [Updated exit readiness](evidence/d0-exit-review-readiness-2026-08-11.md), [lifecycle runbook](../../../infrastructure/runbooks/deployments/staging-runtime-lifecycle.md) |
| 2026-08-10 | Completed the first full on-demand replay. Exact traffic release passed deployed `200/200/401`, persistence, readiness, two-account denial, 500/500 public probes, 25/25 durable workflows, idempotent replay, clean AWS logs/alarms/queues/DLQs, idle ECS, and zero drift. Separately approved traffic-disable, quiescence, and dormancy plans returned staging to no database, endpoint, route, trigger, or queued work while retaining 119 control-plane resources. Only the first complete posted dormant billing interval remains. | [Reactivation acceptance](evidence/d0-staging-on-demand-reactivation-acceptance-2026-08-10.md) |
| 2026-08-10 | Applied the checksum-approved exact nine-action dark activation, recreating protected encrypted RDS and three endpoints without routes/triggers. The retained zero-finding digest-pinned migration task ran exactly once through `0003_retire_legacy_dispatch`, emitted one sanitized success event, and returned ECS to zero tasks. Added exact checksum-gated traffic enable/disable planning plus dark-failure quiescence recovery locally. Phase 0 synthetic profile data will be created through authenticated conformance rather than invented database identities. | [Reactivation/migration evidence](evidence/d0-staging-reactivation-and-migration-2026-08-10.md) |
| 2026-08-10 | Began the reproducible activation drill. The first refresh-backed plan was itself dark and exact, but review found the reusable active validator rejected deletes without allowlisting every create/update. Discarded that unapplied plan and hardened quiescence, dormancy, and activation to exact action sets plus database/endpoint semantics. Parser, policy, and full repository checks pass; AWS remains dormant and unchanged pending merge and fresh planning. | [Activation-guard evidence](evidence/d0-staging-activation-guard-hardening-2026-08-10.md) |
| 2026-08-10 | Completed the first deployed two-stage shutdown from exact merged source. The separately approved quiescence plan disabled three routes and three triggers and removed RDS deletion protection without deletion. The separately approved dormant plan removed the synthetic RDS instance, three interface endpoints, current database-secret version, migration task definition, and database alarms without a snapshot. Final status has zero disposable data-plane resources or work; aggregate retained-state inventory passes. Activation/recreation and a complete dormant cost interval remain open. | [First-shutdown evidence](evidence/d0-staging-on-demand-first-shutdown-2026-08-10.md) |
| 2026-08-10 | Measured the complete preliminary `2026-08-09` interval and found staging's idle cost dominated by RDS and VPC interface endpoints. Product owner approved continuous development plus bounded staging activation. Implemented the local ADR, explicit `active/quiesced/dormant` Terraform boundary, fail-closed invariants, resource tests, checksum-plan operator, and runbook. No AWS mutation occurred. | [Preliminary cost evidence](evidence/d0-post-retirement-cost-preliminary-2026-08-10.md), [ADR-018](../../adr/018-disposable-prelaunch-staging-data-plane.md), [runbook](../../../infrastructure/runbooks/deployments/staging-runtime-lifecycle.md) |
