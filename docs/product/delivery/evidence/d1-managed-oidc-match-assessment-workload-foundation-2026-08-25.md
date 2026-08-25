# D1 Managed-OIDC Match-Assessment Workload Foundation

- Date: 2026-08-25
- Environment: isolated development
- Status: source/local verification passed; managed-OIDC execution and AWS window pending
- Exact source: `0406b2b2cfbb487242a8eb4776985a280a2432d6`

## Boundary

The development-only D1 conformance surface now includes a separately confirmed, read-only match
profile. It requires the same-origin confirmation `run-d1-development-match-assessment-v1` and a
server-held managed-OIDC session. It reads one bounded canonical catalog page, selects the first
current result, and requires one exact no-store `MatchAssessment` response for that same job.

The success result retains only start/end timestamps, duration, one validated catalog-page count,
one validated assessment count, and an aggregate evidence-item count. It never returns or retains a
token, identity, preference, job, match gate, evidence reason, endpoint, request/response body, AWS
identifier, or Auth0 identifier. The profile is read-only and shares the existing single-flight and
15-second deployed-request deadline boundary.

The AWS inspector now accepts the distinct `D1Match` profile with a fixed two-request floor and no
expected 4xx response. It preserves all existing zero-5xx, zero Lambda error/throttle, empty
queue/dead-letter, privacy-safe log, healthy-alarm, idle-ECS, and zero-drift gates.

## Verification

- Focused conformance/panel tests: 18/18 passed.
- Complete web tests: 38 files, 509 tests passed.
- Web typecheck passed.
- Scoped Biome format/lint checks passed.
- Production Next build passed and emitted the exact dynamic
  `/api/d1-conformance/match-assessment-workload` route.
- Development/staging PowerShell parsers and `D1Match` wrapper/help validation passed.
- Docker and WSL were not used.

## Remaining acceptance

Run only **Run match-assessment check** with the approved synthetic managed-OIDC account. Retain only
its displayed aggregate result, then corroborate the exact timestamps with
`-WorkloadProfile D1Match` against the state-197 zero-drift plan. This foundation makes no deployed
match, hosted-web, representative-SLO, human accessibility, security/privacy, product, real-data, or
Phase 1 completion claim.
