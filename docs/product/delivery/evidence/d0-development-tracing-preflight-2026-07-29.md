# D0 Development Tracing Preflight — 2026-07-29

- Scope: D0-006 and D0-011
- Environment: dedicated development, `us-east-2`
- Status: Repository implementation and bootstrap-plan preflight pass; not deployed

## Implemented

- OpenTelemetry Node SDK startup precedes gateway and worker composition.
- HTTP spans export through OTLP/protobuf without configured header/body capture; requests with
  query strings are deliberately not traced because the current API has no query contract.
- Valid W3C trace context is separated from request/audit correlation and propagated through the
  identifier-only outbox, Temporal input, dispatcher, and readiness activities.
- Static worker span names contain no candidate or resource identifiers.
- Each ECS task receives one immutable, non-essential, self-restarting ADOT collector with bounded
  memory, a health check, task-local OTLP, and the X-Ray exporter.
- The application role is limited to the two required X-Ray write APIs; the workload boundary
  permits no broader X-Ray access.
- The deployed verifier is read-only, keeps trace documents in memory, emits aggregate results,
  and rejects forbidden candidate/credential fields.

## Verification

- Observability tests: 10 passed.
- Workflow trace-propagation test: 1 passed.
- Observability, profile service, gateway, and workflow worker type/build checks: passed.
- Terraform formatting and development/bootstrap validation: passed.
- Collector image: AWS-supported ADOT `v0.48.0`, recorded by immutable multi-architecture digest.
- Refresh-backed bootstrap preview: `0` create, `1` in-place update, `0` delete, `0` replace.
- Exact bootstrap preview scope: `aws_iam_policy.workload_boundary` only, adding
  `xray:PutTelemetryRecords` and `xray:PutTraceSegments`.
- The local Docker daemon was unavailable, so no local collector-runtime export is claimed.

## Remaining evidence

1. Merge the implementation with all remote checks passing.
2. Apply the exact workload-boundary update and prove no drift.
3. Publish and scan the merged gateway and worker images.
4. Review/apply the application-only tracing rollout.
5. Complete one synthetic authenticated preference transaction.
6. Prove the complete trace and redaction with the deployed verifier.
7. Prove no drift and record the final evidence.

No AWS resource was changed and no deployed trace is claimed by this preflight record.
