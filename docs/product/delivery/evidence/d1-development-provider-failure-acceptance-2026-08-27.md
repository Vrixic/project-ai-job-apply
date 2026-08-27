# D1 development provider-failure acceptance — 2026-08-27

## Outcome

Exactly one guarded generated-synthetic provider-failure execution passed against exact deployed
release source `48f5d5ba0c2339ec45a818a4c461676ad9ef9191` at development state serial `230`.
The operator injected the fixed failure before any provider adapter, observed it once, completed one
durable recovery attempt, and independently verified cleanup and fresh post-run zero drift.

The accepted records are bound by these SHA-256 values:

- execution plan: `0a00628690965bb74d5c5381095cdde88a9bc6bc3330011517111572256ca8af`;
- sealed receipt: `e953e9de8f7a9e41c66e016cce8489adb3515fa888daf167472234bafb3600cd`;
- aggregate result: `929f3ae295f41df806034cf977940d03a66bb3f48e2fc5225594160c56854797`;
- post-run zero-drift result: `2e6b8b6247e3f612b8e540be9d9044dc8410fa3e59b62570db4d243520512146`;
  and
- fresh post-run Terraform plan: `d0a4ca77e43af20c76ebf03daba42eb9150713cb98a1c6f63a6b48c77b6bcbf1`.

## Aggregate result

- Provider faults injected: `1`.
- Provider failures observed: `1`.
- Recovery attempts: `1`.
- Recoveries succeeded: `1`.
- Provider requests: `0`.
- Observation or catalog writes: `0`.
- Cleanup attempted and succeeded: `true`.
- Mutable post-cleanup fixture artifacts: `0`.
- Retained Jobs/database audit rows: `0`.
- Intentionally retained AWS durable execution histories: `1`.
- Maximum visible/event/DLQ backlog and event age: `0`.
- Error-log and forbidden-log matches: `0`.
- Post-run meaningful Terraform changes: `0`.

Provider authority remained false, configured sources remained empty, and schedules, terminal
handling, and event-source mappings remained disabled. The intentional retained durable history is
the immutable one-run execution evidence, not a cleanup defect. No provider response, candidate
data, payload, log body, account identity, recipient identity, or secret is retained here.

## Scope and remaining gates

This closes the bounded automated provider-failure fixture execution. It does not complete the
representative D1 assurance gate: accountable latency, error, and queue thresholds; an exact
reviewed recipient-set digest; attributable manual alert-delivery confirmation; hosted coverage;
and the final human accessibility, security/privacy, and product dispositions remain open. The
fixed workload is not a production SLO, capacity, RTO, or RPO claim. Phase 1 remains `In progress`.
