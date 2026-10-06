# D3 original approved native bootstrap — 2026-10-06

Status: private source implementation; D3-079 and D1/D3 remain In progress.

The private version-one native owner envelope gains an explicit `bootstrap` action. Existing
actions retain their strict shapes; older receivers refuse the new action, with no fallback.
The task client uses the existing SDK-signed original task/recipient/request context and converts
validated scalar timestamps to Dates only after the authenticated owner reply.

Applications owns the narrow stored-preparation read. It requires an active candidate, the exact
owner/application/generation, a running separately claimed preparation, the same current base
packet and application revision, review-required status and fresh database-time approval. The
eight returned scalars contain the stored original approval, expiry, notice and context hashes;
no approval, work, packet, renewal or candidate content is created or returned. Short SQL locks
are released before Documents or remote awaits. Documents independently checks its pending
original document, context, work identifier/request hash and exact consent expiry. Applications
is rechecked after that await; native admission surrounds the owner operation as before.

The strict reply rejects foreign identities, extra fields, malformed hashes, alternate notices,
noncanonical timestamps, future/expired approval and a duration other than the original 15
minutes. Default-off switches, numeric receiver binding and value-free refusal remain unchanged.
Public OpenAPI/events, SQL migrations, dependencies, Terraform, frontend and hosted CI/CD are
unchanged. This metadata read is not provider permission renewal or continuous admission.

## Local verification

- 41 RPC tests pass, including ten new stored approval/invalid metadata cases. Actual SDK
  signing runs through simulated STS/Lambda transports; no actual AWS task credentials are used.
  Log: `.tmp/d3-native-bootstrap-rpc.log`.
- 27 actual PostgreSQL preparation tests pass, including six new original bootstrap cases:
  queued refusal, owned claimed read/replay with unchanged preparation, foreign scope, disabled
  switch, cancellation, expired/future/failed preparation and replaced/revised application.
  Log: `.tmp/d3-native-bootstrap-sql-final.log`.
- 24 actual PostgreSQL native launcher/owner scenarios pass. The signed owner scenario now
  creates and claims a preparation through the Applications API, binds the document and work to
  its original identity/expiry, reads bootstrap metadata through RPC and rejects a one-millisecond
  consent mismatch and changed facts hash. Secret/STS/Lambda/ECS transports and packet crypto
  authority remain synthetic. Log: `.tmp/d3-native-bootstrap-owner-sql-final.log`.
- Seven emitted owner/launch isolation/default-off checks pass, retaining the task client's
  exclusion of SQL/owning services/provider/render/object capabilities. The receiver excludes
  owning SQL and task control. Log: `.tmp/d3-native-bootstrap-bundles.log`.
- Dependency-closure build and Workflow typecheck pass. The first packet fixture attempted an
  invalid null-current-packet mutation; using the normal owning replacement API corrects it.
  The first composed preparation fixture omitted required field definitions; the fixture now
  uses the owning defaults. Production constraints and controls were not weakened.

Full clean committed-source verification passes at `97938b7395baf5ed0b08d4164114993126cce262`:
38 typecheck tasks, 39 test tasks, 23 builds, operator/security/isolation/Compose/scope checks.
The original verifier session exits zero with the tracked tree unchanged. Lint remains zero
errors, 15 warnings and 58 infos. Log: `.tmp/d3-native-bootstrap-full.log`.
Two local receiver builds reproduce identical ZIP bytes: 364,511 bytes, SHA-256
`b2b36f7b4d3ba48f0308652efb4d020983712c83bbce59f34e9eb7abdf614321`.
The manifest binds exact source `97938b73`, Node.js 24/x86_64, `index.handler` and 32 components.
Logs: `.tmp/d3-native-bootstrap-artifact.log`, `.tmp/d3-native-bootstrap-artifact-repeat.log`.
Nothing is published or deployed.

The owned PostgreSQL fixture used tmpfs with no volume mounts; its exact container is removed.
Docker Desktop engine and WSL are stopped, shared volumes retained and the PC stays on.
The maintained local web launcher is restored against the unchanged live development API:
home returns 200 and anonymous Resume 307, with redirects neither followed nor retained.
No new signed-in browser acceptance is claimed. Only its two generated Next type imports are
restored; frontend source is preserved. Verified source is prepared on the feature branch;
no third PR or main merge is performed.

No deployment, activation, new PR, main
merge or phase completion is claimed. Trusted ECS self-metadata, the executable native bootstrap/
image, provider/TLS adapters, managed IAM/routing and actual client/ATS/provider/accountable
acceptance remain. Existing generated-synthetic development triggers remain unchanged.
