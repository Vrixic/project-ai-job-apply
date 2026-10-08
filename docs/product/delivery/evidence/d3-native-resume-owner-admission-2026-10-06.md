# D3 native resume Applications admission — 2026-10-06

Status: default-off local prerequisite; D1/D3 remain In progress.

Applications adds a private scalar admission port for the caller's existing transaction.
It captures a closed seven-field owner/application/job/revision/packet/hash/job-revision
intent before awaits, requires an active candidate and locks the exact review-required
application and its current packet. The owning application lock and packet share lock
remain until the caller commits or rolls back. It writes no product state, approval,
provider consent or content, and projects failures to a fixed refusal.

This is not a resume generation ledger or an activated preparation path. Documents must
still reserve and bind original generation/base/task/completion metadata, compose Jobs and
source proof, and connect preparation, authenticated reads and readiness. Existing OpenAI
cover-letter grants cannot supply deterministic resume authority. No route, migration,
frontend, infrastructure, deployment or cloud activation changes in this batch.

Applications build and three focused validation/capture/error checks pass. Seven actual
PostgreSQL 16.6 cases pass against an owned loopback tmpfs fixture, with Profile and
Applications migrations replayed twice. Checks cover exact admission with unchanged state,
neighboring identity/revision/hash refusal, both locks held until transaction completion,
original revision drift, legal non-review transitions, cancellation, identity quarantine
and default-off/withdrawal. The first fixture assigned a packet without advancing revision;
it was corrected to respect the existing SQL transition guard. No guard was weakened.
Logs: `.tmp/d3-native-resume-admission-{build,units,sql}.log`.

Full frozen-source verification follows. No new PR, main merge, hosted CI/CD work or
managed acceptance is asserted. ADR-040 remains Proposed. Shared volumes remain and the
PC stays on. The owned SQL fixture is removed and Docker/WSL stopped after SQL work.

## Full frozen-source verification

Clean committed source `c81c2ba775c559cae7c46c087d47c43f5700c6c9` passes the original
`scripts/verify-phase0.ps1` run with matching ARTIFACT_SOURCE_SHA and terminal exit zero.
All 38 typecheck tasks, 39 test tasks, 23 builds and operator/security/artifact isolation/
Compose/scope checks pass. Lint remains zero errors, 15 warnings and 58 infos. The tracked
tree remains unchanged during the run. Log: `.tmp/d3-native-resume-admission-full.log`.

This repository run is separate from the seven opt-in real SQL cases above. It does not
prove resume owner integration, managed deployment or native production-image acceptance.
The development web is restored afterward; no repeated human acceptance is requested.
