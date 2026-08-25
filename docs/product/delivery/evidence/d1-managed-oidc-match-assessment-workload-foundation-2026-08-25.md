# D1 Managed-OIDC Match-Assessment Workload Foundation

- Date: 2026-08-25
- Environment: isolated development
- Status: managed-OIDC application and AWS acceptance passed
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

## Managed-OIDC result

The approved synthetic account passed the exact profile. Only this aggregate result is retained:

```json
{
  "profile": "d1_deployed_match_assessment_v1",
  "startedAt": "2026-08-25T01:26:49.938Z",
  "endedAt": "2026-08-25T01:26:50.833Z",
  "durationMs": 895,
  "catalogPagesValidated": 1,
  "matchAssessmentsValidated": 1,
  "evidenceItemsValidated": 9
}
```

## AWS result

The exact one-minute `D1Match` window passed against the state-197 zero-drift plan. Only this
aggregate result is retained:

```json
{
  "environment": "development",
  "workloadProfile": "D1Match",
  "windowMinutes": 1,
  "apiRequests": 2,
  "minimumApiRequests": 2,
  "api4xx": 0,
  "minimumExpected4xx": 0,
  "api5xx": 0,
  "apiLatencyAverageMs": 219,
  "apiLatencyMaximumMs": 348,
  "lambdaInvocations": 3,
  "lambdaErrors": 0,
  "lambdaThrottles": 0,
  "lambdaDurationMaximumMs": 206.55,
  "databaseCpuMaxPercent": 5.38,
  "databaseConnectionsMax": 3,
  "eventQueueAgeMaxSeconds": 0,
  "eventQueueVisibleMax": 0,
  "deadLetterMessagesMax": 0,
  "durableDeadLetterMax": 0,
  "logEvents": 5,
  "logErrorMatches": 0,
  "forbiddenLogMatches": 0,
  "activeEcsServices": 0,
  "runningEcsTasks": 0,
  "runtimeAlarmsOk": 10,
  "dispatchTarget": "lambda_durable",
  "triggersEnabled": true,
  "terraformDrift": 0
}
```

This closes the bounded deployed match-assessment execution gap. It is not hosted-web,
representative-SLO, human accessibility, independent security/privacy, broader product, real-data,
or Phase 1 completion evidence.
