# Prelaunch cloud lifecycle follow-up

- Status: Complete
- Start: 2026-10-08
- Completion: 2026-10-08
- Owner: Platform engineering
- Last updated: 2026-10-08

This operational follow-up supersedes continuously running development. It does not retroactively
change the historical D0 acceptance. The owner's shutdown requirement applies after every bounded
test session. Follow [ADR-042](../../adr/042-data-preserving-development-dormancy.md).

| ID | Task | State | Evidence or remaining work |
|---|---|---|---|
| OPS-001 | Quiesce development and remove NAT/EIPs and paid interface endpoints while retaining data. | Complete | Other session's `c24c02b1` and `d3e53ff2`, merged in #568; independently read back zero NAT/EIPs/interface endpoints, application rules and queue consumers on 2026-10-08. |
| OPS-002 | Remove development's automatic RDS restart exposure using verified encrypted snapshots and a restore path. | Complete | Encrypted current snapshot restored to a private available instance; original and restore instances removed, final snapshot available. [Evidence](evidence/prelaunch-development-dormancy-2026-10-08.md). |
| OPS-003 | Independently verify staging is dormant. | Complete | Account assignment corrected; fresh sign-in followed by independent live runtime/queue checks and a passing dormant-day billing check. [Evidence](evidence/prelaunch-development-dormancy-2026-10-08.md#staging-access-restored-and-dormancy-verified--2026-10-08). |
| OPS-004 | Record latest dormant inputs, reactivation and mandatory return-to-dormancy procedure. | Complete | Exact-input dormant plan has no changes; recovery inputs/proof archived and verified in versioned KMS-encrypted state storage. [Evidence](evidence/prelaunch-development-dormancy-2026-10-08.md). |

## Work log

| Date | Work | Evidence |
|---|---|---|
| 2026-10-08 | Reconciled finalized August $79.74 and September $151.27 development billing. NAT availability rose $6.62 to $61.83; VPC rose $38.48 to $57.27. Found no automatic budget action and October 1–7 estimated $33.58. | Live account-scoped Cost Explorer reads; no candidate data or credentials retained in repository. |
| 2026-10-08 | Detected the other session's live state lock, held competing deployment, archived overlapping local prototype, and based the database-only follow-up on its committed networking shutdown. | Dedicated `fix/prelaunch-database-dormancy` checkout; no old prototype applied. |
| 2026-10-08 | Added a fail-closed database-only lifecycle. Retained baseline has no resource changes; preparation changes only the existing DB protection and final-snapshot settings. | Full platform suite 227 passing before one additional passing restore test; all five focused lifecycle tests pass. Offline plan-safety tests: 17 passing. |

## Remaining acceptance

- [x] Encrypted current snapshot restores to a private available RDS instance.
- [x] Original and temporary restore database instances are absent; final snapshot is available.
- [x] Development has zero paid runtime networking and no active application triggers/tasks.
- [x] Latest dormant Terraform plan is resource-change free and recovery inputs are retained privately.
- [x] Staging live dormancy is independently verified with valid access.
- [x] Retained billable security, data and recovery resources are disclosed.

2026-10-08: Development live shutdown, physical restore and recovery archival completed; [final evidence](evidence/prelaunch-development-dormancy-2026-10-08.md). Overall completion remains blocked solely on staging access and verification.

2026-10-08 completion: Staging access restored and live dormancy independently verified; all operational acceptance criteria satisfied. No staging mutation was needed. Development lifecycle PR #570 is merged. Retained resource costs remain disclosed; historical application/privacy acceptance is unchanged.
