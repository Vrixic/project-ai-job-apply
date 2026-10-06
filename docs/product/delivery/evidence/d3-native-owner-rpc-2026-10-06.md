# D3 authenticated native owner RPC — 2026-10-06

Status: source/local verification passed. D1/D3 remain In progress; no deployment or activation.

The native runtime needs usable authenticated admission, evidence and original scalar controls.
The new private RPC envelope version one requires original allocation/work binding, a closed
operation and a fresh credential-bearing task proof. It does not accept the previous standalone
scalar contracts. Canonical request metadata binds the proof and response to the exact operation
and numeric recipient; no authentication downgrade/fallback is supported.

The receiver verifies the actual STS reply against the configured original ECS task role/session
before resolving a database secret or creating owners. Deployment configuration pins cluster,
immutable task-definition revision and container. Short owning admission surrounds owner awaits,
without keeping its SQL transaction open across them. Evidence uses existing owner APIs and a
separate active-candidate lease. Documents also checks the original stored reviewed hashes and
server-time consent expiry before and after evidence reads. A caller-selected fresh context does
not replace that original approval.

The actual owner runtime supplies original work claim, positive settlement/rejected/undispatched
settlement and immutable scalar completion. It creates no issuer, renewal, provider/model,
renderer, object storage, task-launch/stop or background-terminal settlement port. Unknown
acknowledgements remain unavailable; the dedicated process cannot certify its own death or purge.
The client's active admission and credential-bearing bytes last until original transport settles,
even after its timeout. Owned byte buffers are then cleared; physical string zeroization is not
claimed. Proof headers never reach owner adapters or response envelopes.

The private `createNativeOwnerEvidenceClient` exposes fixed source/admission ports. Native work
controls support an explicit authenticated envelope mode; that mode never falls back to old RPCs.
The native content runtime fixes this mode's binding to its own detached original binding before
awaiting admission. This connects the adapter source; an actual production native image/bootstrap,
TLS/routing/IAM/managed task conformance and candidate/provider/accountable acceptance remain.

## Source configuration and rollout

The lazy workflow entrypoint is `backend/workflows/src/native-owner-rpc-lambda.ts`.
It defaults off. Managed configuration requires `NATIVE_OWNER_RPC_ENABLED=true`, us-east-2,
account/name/numeric-version identity, a same-account managed `DATABASE_SECRET_ID`, and
`NATIVE_OWNER_RPC_DEPLOYMENT_JSON` containing exactly `taskRoleArn`, `clusterArn`,
`taskDefinitionArn`, and `containerName`. Credentials and candidate values are not configuration
payloads. Production SQL clients use managed secret resolution; task signing/invocation uses
only explicit ECS task credentials, with no workstation/profile/AssumeRole fallback.

Deploy/review a separate retained numeric receiver and its ECS-only role trust, exact invocation
permissions, database ownership, private STS reachability and bounded resources before enabling
native tasks. Point the new native source/control configuration to that exact receiver; keep old
standalone receivers for their existing callers until separately retired. Rolling back routing
must never authorize a native task to omit the required proof. No public API, domain/event schema,
SQL migration, dependency pin, Terraform/IAM, frontend, CI/CD or cloud state is changed here.

## Verification

31 new RPC cases plus 107 caller/control regressions and two existing native-runtime checks pass
(140 focused). Actual SDK signing runs through simulated Lambda/STS and owner replies, exercising
admission, evidence, claim, settlement and completion. Cases cover retargeted operation/task/
recipient/deployment, authentication-before-owner access, pending-call admission, revoked owning
admission/feature flags, invalid response acknowledgements, context mismatch, restricted/unknown
facts, malformed provenance and production refusal of test ports.
Log: `.tmp/d3-native-owner-focused-final-2.log`.

All 24 PostgreSQL launcher/evidence cases pass on an owned PostgreSQL 16.14 tmpfs fixture.
The new case executes actual lazy owner composition, approved Profile fact/job reads, original
work claim/settlement and scalar completion, then refuses sealed admission. Simulated STS refusal
proves no secret/SQL initialization before authentication; managed secret/Lambda/ECS/STS transports
remain synthetic. Existing migrations replay unchanged, including Jobs through 0027. The initial
fixture used the catalog write result as its read projection and tried changing immutable
application identity. Using the owning read projection and constructing the original reviewed
application/document context before launch fixes those harness errors; no production constraint
is weakened. Log: `.tmp/d3-native-owner-sql-final-3.log`.

All eight emitted isolation/default-off checks pass, including three new task/receiver/actual-owner
checks. The exact scalar bundle inventory now includes only the proof/RPC pure metadata additions;
SQL, owner/provider/model/render/task capabilities stay excluded from that client. All 21 actual
Linux process/kernel scenarios pass with retained local image
`sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4`.
These scenarios use actual source composition/TLS/render/process retirement and synthetic remote
ports; they do not certify a production image or managed authentication.
Logs: `.tmp/d3-native-owner-bundles-final.log`, `.tmp/d3-native-owner-linux.log`.
Documents/Workflow typechecks and dependency-closure builds pass. Full verification passes on
clean committed source `576f0ac986306c8a23f27f5f6a9312303a709adf`: 38 typecheck tasks,
39 test tasks and 23 builds, plus maintained operator/security/isolation/Compose/scope checks.
The original verifier session exits zero with the tracked tree unchanged. Lint remains zero
errors, 15 warnings and 58 informational notes. Cached unaffected tasks are included in these
totals. Log: `.tmp/d3-native-owner-full.log`.

The new maintained source-bound builder emits a separate Node.js 24/x86_64 receiver artifact
with default-off/no-network bundled refusal checks. Two builds on the same clean source have
identical ZIP bytes: 363,458 bytes, SHA-256
`cf96d7e142d6875fbc1f6c792d9c3588a8ec5c9437938fd38e4835d24cbf0c83`.
Its manifest names exact source `576f0ac9`, `index.handler` and 32 SBOM components. Local ZIP,
checksum, manifest, SBOM and readable bundle exist under
`backend/workflows/dist/native-owner-rpc-lambda/`; nothing is published or deployed.
Logs: `.tmp/d3-native-owner-artifact.log`, `.tmp/d3-native-owner-artifact-repeat.log`.

The owned PostgreSQL tmpfs fixture is removed and the Linux verifier removes its own staging/
container. Shared volumes are retained. Docker Desktop's engine and WSL are stopped; PC stays on.
PR #564/#565 remain OPEN at their existing exact heads; no third PR or main merge is performed. No actual ECS credentials, AWS verification, live model, deployment,
managed authentication conformance or phase completion is claimed. PC stays on.
