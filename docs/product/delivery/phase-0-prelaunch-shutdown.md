# Prelaunch cloud lifecycle follow-up

- Status: In progress
- Start: 2026-10-08
- Completion: Not completed
- Owner: Platform engineering
- Last updated: 2026-10-08

This operational follow-up supersedes continuously running development. It does not retroactively
change the historical D0 acceptance. The owner's shutdown requirement applies after every bounded
test session. Follow [ADR-042](../../adr/042-data-preserving-development-dormancy.md).

| ID | Task | State | Evidence or remaining work |
|---|---|---|---|
| OPS-001 | Quiesce development and remove NAT/EIPs and paid interface endpoints while retaining data. | Complete | Other session's `c24c02b1` and `d3e53ff2`, merged in #568; independently read back zero NAT/EIPs/interface endpoints, application rules and queue consumers on 2026-10-08. |
| OPS-002 | Remove development's automatic RDS restart exposure using verified encrypted snapshots and a restore path. | In progress | Independent database lifecycle, exact-plan guard, five Terraform lifecycle tests and 15 offline plan-safety checks implemented; live snapshot/restore and final shutdown evidence pending. |
| OPS-003 | Independently verify staging is dormant. | Blocked | Fresh SSO sign-in succeeds, but AWS `GetRoleCredentials` returns `ForbiddenException: No access`; the identity's account list contains development only. Correct staging assignment is required. |
| OPS-004 | Record latest dormant inputs, reactivation and mandatory return-to-dormancy procedure. | In progress | [Database runbook](../../../infrastructure/runbooks/deployments/development-database-dormancy.md), [operator](../../../scripts/operate-development-database-lifecycle.ps1); final exact-input drift and retained-cost evidence pending. |

## Work log

| Date | Work | Evidence |
|---|---|---|
| 2026-10-08 | Reconciled finalized August $79.74 and September $151.27 development billing. NAT availability rose $6.62 to $61.83; VPC rose $38.48 to $57.27. Found no automatic budget action and October 1–7 estimated $33.58. | Live account-scoped Cost Explorer reads; no candidate data or credentials retained in repository. |
| 2026-10-08 | Detected the other session's live state lock, held competing deployment, archived overlapping local prototype, and based the database-only follow-up on its committed networking shutdown. | Dedicated `fix/prelaunch-database-dormancy` checkout; no old prototype applied. |
| 2026-10-08 | Added a fail-closed database-only lifecycle. Retained baseline has no resource changes; preparation changes only the existing DB protection and final-snapshot settings. | Full platform suite 227 passing before one additional passing restore test; all five focused lifecycle tests pass. Offline plan-safety tests: 15 passing. |

## Remaining acceptance

- [ ] Encrypted current snapshot restores to a private available RDS instance.
- [ ] Original and temporary restore database instances are absent; final snapshot is available.
- [ ] Development has zero paid runtime networking and no active application triggers/tasks.
- [ ] Latest dormant Terraform plan is resource-change free and recovery inputs are retained privately.
- [ ] Staging live dormancy is independently verified with valid access.
- [ ] Retained billable security, data and recovery resources are disclosed.
