# D0-016 Gateway Dark-Deployment Source Evidence — 2026-07-31

- Delivery: D0-016 scale-to-zero runtime migration
- Scope: SR-001 inspection tooling, SR-002 release artifact, and gateway portion of SR-005
- Evidence class: Local implementation and read-only cloud preflight
- AWS mutation: None
- API traffic change: None

## Privacy-safe outbox baseline path

The profile owner now includes a bounded inspector that selects only pending outbox event ID,
creation time, and attempt count inside a PostgreSQL `READ ONLY` transaction and one-connection
pool. It emits pending count, oldest time, maximum attempts, and a SHA-256 over ordered immutable
event IDs. It never selects payload, subject, trace context, candidate identity, or user data.
Individual IDs remain absent unless the operator explicitly selects `-IncludeEventIds` in a
synthetic-only environment.

`scripts/inspect-deployed-outbox.ps1` reuses the existing digest-pinned on-demand migration task,
validates its secret/log/runtime boundary, requires a separate `-Execute` switch, starts exactly
one task with ECS Exec disabled, verifies a successful exit, and accepts exactly one versioned
sanitized result record. The development no-execution preflight passed. The deployed image does not
yet contain the inspector, so no task was started and SR-001 remains in progress until a reviewed
image is published and both exact baselines are captured.

## Reproducible gateway release artifact

The gateway build now compiles the complete dependency graph before bundling so Nest decorator
metadata is retained. The release builder creates one fixed-metadata ZIP without source maps,
calculates hexadecimal and base64 SHA-256 digests, writes a manifest, and derives a CycloneDX 1.6
SBOM from the dependencies actually present in the esbuild input graph. Optional Nest transports
that the gateway does not register remain explicitly absent.

Two consecutive local builds produced the same ZIP SHA-256:

`1b9e1e0b604138ac2c7f9b721eca2d3a172ddf89ca2ad7b723e5ec822f856e7c`

The ZIP was 1,011,423 bytes and the SBOM contained 117 library components. The bundled handler
imported successfully. `pnpm audit --audit-level high` found no known vulnerabilities. These values
identify a local build only; the release workflow will rebuild from an exact merged commit and its
published digest supersedes this local diagnostic value.

The manual `main`-only workflow tests and audits the gateway, proves reproducibility, validates the
SBOM, assumes the selected environment through OIDC, verifies the artifact bucket remains private,
versioned, and KMS encrypted, refuses existing immutable keys, and uploads the ZIP plus evidence
under a source-and-digest-bound prefix. It publishes no Lambda and changes no traffic.

## Disabled-by-default dark infrastructure

Terraform now defines, behind `deploy_gateway_lambda = false`:

- a Node.js 24 Lambda published version and environment alias;
- an exact-issuer/audience JWT authorizer that is not attached to any route;
- Lambda invocation permission restricted to the existing exact HTTP API stage;
- private-subnet/RDS connectivity with reserved concurrency two and two database connections per
  warm execution environment;
- managed-secret retrieval through the AWS Parameters and Secrets extension, least-privilege IAM,
  one single-AZ Secrets Manager interface endpoint, and no NAT gateway;
- native X-Ray tracing, privacy-safe shared application logs, and error/throttle/p95-duration
  alarms; and
- outputs for later function-level conformance.

No Lambda integration or route exists in this change. Enabling the dark resources cannot move API
traffic from ECS. The current gateway and worker tasks, VPC Link, Cloud Map, Temporal worker, and
all rollback resources remain unchanged.

Provider 5.100 rejected the accepted `nodejs24.x` runtime during validation. The environment roots
and lock files now select AWS provider 6.57.1, while reusable modules permit supported 5.80–6.x
callers. Provider-6 region-attribute and Cloud Map deprecations were removed. Fresh backend-disabled
development and staging initialization/validation passed with Terraform 1.9.8 and AWS provider
6.57.1. Because this is a major provider upgrade, a refresh-backed no-drift/provider plan remains a
mandatory separate review before any dark apply.

## Verification

| Check | Result |
|---|---|
| Profile service typecheck and outbox-inspection tests | Passed: 3 tests; existing DB integration skipped without its opt-in URL |
| Development outbox operator without `-Execute` | Passed; cloud mutation false |
| Config Lambda database-source tests | Passed as part of 17 config tests |
| Gateway typecheck and tests | Passed: 3 files, 12 tests |
| Two consecutive artifact builds | Same SHA-256; handler import passed |
| Dependency audit at High severity | No known vulnerabilities |
| Terraform formatting | Passed |
| Fresh development and staging Terraform validation | Passed under Terraform 1.9.8/AWS provider 6.57.1 |
| Complete Phase 0 repository verifier | Passed; all 12 build tasks completed, including the production web build |

Not yet claimed: merged-commit artifact publication, artifact-bucket version evidence, live
refresh-backed provider plan, dark-resource plan/apply, resource-policy/direct-invocation proof,
function health/readiness, deployed logs/traces/alarms, API cutover, or old-runtime retirement.
