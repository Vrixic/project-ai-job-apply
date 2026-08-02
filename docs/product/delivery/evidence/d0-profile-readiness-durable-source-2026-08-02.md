# D0-016 SR-004 profile-readiness durable source evidence

- Date: 2026-08-02
- Scope: Lambda durable profile-readiness workflow, private activity boundary, terminal recovery,
  local durability conformance, and reproducible artifacts
- Status: Locally complete; no AWS resource, artifact object, trigger, route, or traffic changed

## Implemented boundary

The existing profile-readiness orchestration is ported to an immutable version-one Lambda durable
handler. The durable payload contains only event, preference-set, operation, version, and trace
identifiers. The orchestrator has no database credential or candidate preference body. It invokes
an exact numeric version of the private activity Lambda through stable named operations and five-
attempt deterministic exponential backoff with jitter.

The profile activity reloads preferences from PostgreSQL, calculates readiness, and persists the
result. Running, completion, compensation, and terminal-event transitions verify the operation and
preference set share one internal owner. They are idempotent: replay cannot downgrade success or
emit a duplicate readiness event. FAILED, TIMED_OUT, and STOPPED durable status events reconcile by
the recorded execution name; this is the recovery path because stopping a durable execution
terminates in-progress operations rather than running workflow cleanup code.

The production profile-readiness workflow has no callback and no reversible external provider
effect. The official local runner separately proves bounded callback success and expiry as a test-
only conformance fixture. No raw AWS callback identifier is exposed to a browser or added to the
product surface.

## Version and dependency boundary

- `@aws/durable-execution-sdk-js` is pinned to `2.1.0`.
- `@aws/durable-execution-sdk-js-testing` is pinned to `1.1.3`, the newest test SDK whose declared
  peer range includes runtime SDK `2.1.0`.
- Workflow definition version and operation names are immutable version-one constants.
- Activity targets reject aliases, `$LATEST`, and unqualified ARNs; only exact numeric Lambda
  version ARNs are accepted.
- The SDK is bundled into the artifact rather than relying on a mutable runtime copy.

## Validation

- Workflow unit/local-durable tests: 21 passed, including replay without repeated effects,
  transient recovery, five-attempt exhaustion, non-retryable failure, compensation, callback
  success, callback expiry, STOPPED/FAILED/TIMED_OUT reconciliation, input rejection, and version
  guards.
- Real PostgreSQL integration: 3 passed twice consecutively against the same database, including
  duplicate completion suppression, terminal-state monotonicity, exact owner association, and
  stopped-execution reconciliation.
- Two consecutive artifact builds produced identical outputs:
  - profile durable ZIP SHA-256:
    `35321924d6dd3272488135ffdef82b8ff8cdca29a49623faa14627712160bd64`
  - profile activity ZIP SHA-256:
    `cded56496cebe036eddbd7c2514cba42307ba88e7525de93721c8dc74e64c051`
  - workflow ingress ZIP SHA-256 after the shared profile-store hardening:
    `41635208212a23d7d72178676034112ac8845f9606641a7a1d02ea3e958bfc53`
- Each build emits a Node.js 24 manifest, SHA-256 checksum, and CycloneDX 1.6 SBOM under ignored
  `backend/workflows/dist/lambda/` output.

The behavior follows AWS's documented replay/checkpoint, execution-name idempotency, callback,
stop, version-pinning, and dependency-packaging guidance:

- [Durable execution SDK and replay](https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-sdk.html)
- [Idempotent durable execution names](https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-idempotency.html)
- [Callback operations](https://docs.aws.amazon.com/durable-execution/sdk-reference/operations/callback/)
- [Stopping durable executions](https://docs.aws.amazon.com/lambda/latest/api/API_StopDurableExecution.html)
- [Supported runtimes and SDK packaging](https://docs.aws.amazon.com/lambda/latest/dg/durable-supported-runtimes.html)

## Remaining gate

SR-005 must add the exact disabled Terraform resources, IAM checkpoint/invoke permissions,
customer-managed KMS durable configuration, private activity access, terminal EventBridge rule,
alarms, artifact publication, and a refresh-backed no-route-change dark plan. Until that separately
reviewed work is applied and accepted, the existing ECS/Temporal path remains live and the gateway
continues to create Temporal-targeted events.
