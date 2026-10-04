# D3-064 isolated provider bootstrap source validation

Date: 2026-10-04. Branch `feat/d3-isolated-provider-bootstrap`, fresh base main
`bde17d9ed94448fb04393f295122176a875a8d2b`, independently of open
[PR #533](https://github.com/Vrixic/project-ai-job-apply/pull/533). Backend only, default-off.
No publication, cloud resources/permissions, deployment, live provider call or activation.

## Boundaries and executed local checks

The [isolated bootstrap](../../../../backend/services/documents/src/cover-letter-isolated-provider-lambda.ts)
qualifies the exact numeric invoked target, region/account, distinct same-account private
control/capture function identities/versions, bucket/KMS and managed-secret ARN before I/O.
Both dedicated flags must be exactly true; database configuration and a plaintext API key
are refused. Configuration stays pinned and is rechecked across asynchronous setup. These
checks do not authenticate callers; reviewed IAM remains required.

The [key resolver](../../../../backend/services/documents/src/lambda-provider-key.ts)
uses the fixed Lambda extension URL with one read, a three-second deadline and a 4,096-byte
response limit. It returns only a bounded non-whitespace plaintext SecretString and fixed
errors. Binary/malformed/oversized/stalled bodies fail and cancel the reader. Concurrent
read-only setup coalesces, but completed invocations do not retain API keys. The managed
extension owns its cache/rotation; no environment/database fallback is provided.

Native object/Invoke clients use maxAttempts one and ignore configured endpoint overrides.
The real actor receives the frozen transition-only facade, exact-version work-control and
creation-capture clients and a per-invocation background gateway. It cannot initialize, renew,
dispose or purge through those ports. Source capability omission is not deployed IAM denial.
Existing one-dispatch/capture/result binding and ambiguous-ACK behavior remain.

- [70 focused units](../../../../backend/services/documents/src/cover-letter-isolated-provider-lambda.test.ts)
  and [managed-key tests](../../../../backend/services/documents/src/lambda-provider-key.test.ts) pass.
  These cover configuration refusal before I/O, exact target, reflection failures, closed input,
  concurrent setup, secret-read failure/retry, configuration withdrawal, conditional-only
  object writes, original result/replay, and lost claim/reservation/capture/object ACKs without
  another model call. No credentials/diagnostics appear in returned envelopes.
- All seven Documents PostgreSQL integration files: **266 cases pass**, including
  [four new connected bootstrap cases](../../../../backend/services/documents/src/cover-letter-response-store.integration.test.ts).
  These use the actual isolated actor, control/capture clients and native private max-one SQL
  bootstraps, with generated-synthetic owned grant/slot fixtures. Successful generation,
  quarantine and lost committed capture/settlement ACKs preserve inventory and original
  provider state; replay makes no second model POST. The initializer/final-document pipeline
  is outside this fixture; no live end-to-end claim.
- Provider HTTP, S3, Lambda Invoke delivery, managed-key/database-secret resolution and
  authentication are simulated. PostgreSQL 16.6 is real. Two private pools each have max one
  connection, initialize once and close; the actor has no SQL client.
- [Compiled dependency graph check](../../../../scripts/tests/isolated-provider-bundle.test.mjs)
  passes: no SQL, Profile/private persistence, rendering, test fixture or disposal runtime in
  the isolated bundle. The maintained verifier now includes this additional check.
- All 1,049 Documents unit cases pass. Full `scripts/verify-phase0.ps1` passes terminally:
  38 typecheck tasks, 39 test tasks, 23 builds, unchanged public generated contracts,
  formatting, baseline lint (0 errors, 15 warnings, 58 informational notes), operational/
  security regressions, additional compiled isolation check, Compose and product scope.

Ignored local logs: `.tmp/d3-064-focused-last.log`, `.tmp/d3-064-documents-integration.log`,
`.tmp/d3-064-full-verification.log`. Exact tmpfs fixture removed; Docker Desktop/WSL stopped.

## Packaging and remaining prerequisites

The [separate local builder](../../../../scripts/build-isolated-provider-lambda.mjs) uses the
existing source-bound artifact format and actual bundled default-off/closed-envelope smoke
checks. It does not modify the maintained private-control/document publication families or
introduce a provider publisher. One artifact set (archive/bundle/manifest/CycloneDX SBOM)
builds from exact clean source `c7382cd`; independent archive byte/hash, bundle equality,
manifest/source and SBOM integrity checks pass. Actual bundled default-off and closed-input
refusal pass with zero fetch calls. Archive SHA-256:
`543057ddda94ea8a8139c9f70a019dc3a6893cac532b94c4507135c69fadc684`.
The 365,756-byte archive and its four-file set remain local and unpublished.
Artifact build log: `.tmp/d3-064-isolated-artifact.log`.

No public wire/schema, migration/backfill, frontend, Terraform or production runtime changes.
The original-terminal path in #533 is a separately reviewed source change; pair any reviewed
actor with compatible numeric private targets. Existing activation and release guards remain.
Reviewed role/bucket/KMS/secret/private-caller IAM, remote original writer drain, maintenance
and transient retention, real-provider evaluation, accountable approval and deployed acceptance
remain open. Local timeout never proves remote quiescence. D1/D3 stay In progress. Hosted
CI/CD remains deferred by owner until production launch, without a security/privacy/release waiver.

## Combined original-terminal integration checkpoint

2026-10-04: locally integrate exact open #533 head `1abc7e7` into #534 as `8aba600`.
Both entire test additions are retained. An initial conflict-script error dropped delivery
text; complete tracker/phase records are restored from both original heads, with an independent
line-set audit proving every original line survives.
No GitHub merge is claimed. Add six native-bootstrap PostgreSQL cases for failed, cancelled,
incomplete, lost committed terminal ACK, quarantine after capture and another running private
writer. All **285 PostgreSQL cases across seven files pass** on the combined source.

The actual isolated actor routes the captured original terminal receipt through its real
control client, native private bootstrap and owning transaction. It leaves result pending,
fences unclaimed phases and settles only the original provider grant. Other running work stays
pending; finalization cannot be reopened. Replay performs no second model POST or settlement
call. A lost terminal SQL/Lambda ACK remains in_progress although committed work is settled.
Provider HTTP/S3/Invoke/secret/authentication are simulated; SQL is real. The initializer/
final-document workflow and authenticated deployed journey remain outside these fixtures.
The initial combined run caught missing lost-ACK injection in the new fixture; the corrected
full run adds an explicit assertion that every intended fault actually occurred. No guard
was weakened. Exact tmpfs fixture removed; Docker Desktop/WSL stopped. Combined full maintained
verification passes: 1,084 Documents units, 283 AI SDK units, 38 typecheck tasks, 39 test
tasks and 23 builds plus compiled isolation, public contracts, formatting/baseline lint
(0 errors, 15 warnings, 58 informational notes), operational/security regressions, Compose
and scope. Rebuilt combined exact-source artifacts remain.

Logs: `.tmp/d3-064-combined-integration-final.log`,
`.tmp/d3-064-combined-full-verification.log`. IAM, original writer drain, maintained retention/
disposal, production composition, accountable/deployed acceptance and D1/D3 exit gates remain.

Combined exact clean source `f23accd` builds all five artifact sets (20 local files): isolated
provider plus the four existing private controls. Independent archive/bundle/manifest/SBOM
integrity checks pass for all five; actual bundled default-off/closed-input refusal passes,
including `settle_terminal` with zero fetch calls. The isolated archive SHA-256 is
`79140fde006cb45df3f0d1845f57b00c896761309d66271ee84fbf95ce400a41`.
Artifacts remain unpublished. Logs: `.tmp/d3-064-combined-isolated-artifact.log` and
`.tmp/d3-064-combined-private-artifacts.log`. Later recording changes documentation only.
