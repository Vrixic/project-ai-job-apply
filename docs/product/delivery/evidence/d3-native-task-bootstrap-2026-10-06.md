# D3 original native task startup composition — 2026-10-06

Status: source-only/default-off; D3-079 and D1/D3 remain In progress.

The private task bootstrap now connects its own ECS metadata, the authenticated original
approval bootstrap and the existing Linux content runtime. It accepts the launcher's original
seven scalar environment identifiers, not caller approval/context or a supplied task ARN.
It reads both current-container and task metadata from the fixed link-local v4 endpoint, matches
the container IDs/name/image metadata, single normal container, cluster, family/revision and
task labels, then creates a detached original binding. Additive AWS metadata is allowed; unsafe
origins/paths, redirects, foreign identities, sidecars, stopped states, malformed/oversized
responses and missing fields refuse. Reads share a three-second abort bound; returned bodies
are bounded to 64 KiB, buffers cleared and diagnostics value-free. The injected test transport
guard remains captured across awaits. Metadata alone is not IAM, liveness or retirement proof.

AWS documents the injected `ECS_CONTAINER_METADATA_URI_V4`, current-container/task paths and
additive metadata behavior in its [Fargate v4 endpoint documentation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-metadata-endpoint-v4-fargate.html),
with [response fields](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-metadata-endpoint-v4-fargate-response.html).
The launcher remains responsible for validating its immutable image and task-definition envelope.

Startup consumes one process admission before any await. Linux/x86_64/Node 24 and the main thread
are required. Signed read-only admission observations wait at most 20 seconds for the launcher
to store its original RunTask binding. Each transport remains one-attempt; no work, consent or
allocation is created/renewed/retried. The stored approval is read only after owning admission;
trusted image ports load afterward, admission repeats, and only then does the existing runtime
arm the kernel and read candidate evidence. Expired approval and switch revocation refuse.
The provider/transport/kernel references and scalar deployment are detached before owner awaits.
The bootstrap has no SQL, object storage, issuer, ECS control or candidate-supplied port path.

## Local verification

- 72 focused checks pass: 29 metadata/refusal cases, 41 existing authenticated RPC cases and
  two runtime refusal cases. Metadata/STS/Lambda responses and credentials are synthetic.
  Log: `.tmp/d3-native-task-bootstrap-focused-final-2.log`.
- 27 actual Linux/kernel/process scenarios pass, including six new startup scenarios. Real
  metadata-to-signed-owner composition reaches actual kernel-bound generation, PDF/DOCX
  rendering and authenticated HTTPS reads, including a delayed launcher bind. Post-kernel
  revocation retires the actual child. Expired approval, exhausted original admission waiting
  and port-load revocation exit before content admission with zero provider/work calls.
  Metadata, STS/Lambda/owning controls, provider replies and candidate identity remain synthetic;
  no managed task, live provider or production image is claimed. Existing compiler image is
  `sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4`.
  Its two exact optional-canvas startup diagnostics retain the existing local-fixture allowance;
  arbitrary/content-derived diagnostics still fail. Log: `.tmp/d3-native-task-bootstrap-linux-final-2.log`.
- Five emitted isolation/default-off checks pass, including new bootstrap capability checks.
  Log: `.tmp/d3-native-task-bootstrap-bundles-final.log`.
- Documents build and changed-source formatting/lint pass without new diagnostics. The first
  default-off test used `enabled: undefined`, incompatible with exact optional properties;
  omitting the property fixes the fixture. New refusal children originally fell through into
  an older generation fixture after their assertions; the dispatcher now exits after return.
  No production guard, deadline or expectation of kernel retirement was weakened.

Full clean committed-source verification passes at `0565ecdabc4ce726ac3b73f934a1153c3c149a28`:
38 typecheck tasks, 39 test tasks, 23 builds, maintained operator/security/isolation/Compose/scope
checks. The original verifier session exits zero and the tracked tree stays unchanged throughout.
Lint remains zero errors, 15 warnings and 58 infos. Log: `.tmp/d3-native-task-bootstrap-full.log`.

The maintained Linux verifier removes its
owned container/staging; Docker Desktop and WSL are stopped, shared volumes retained and PC on.
Public APIs/events, SQL migrations, dependency versions, infrastructure and frontend are unchanged.
No deployment, activation, publication, third PR or main merge occurs; CI/CD remains deferred.

The maintained local web launcher is restored against the unchanged live development API:
home returns 200 and anonymous Resume 307 without following or retaining redirect values.
No new signed-in acceptance is claimed. Only its two generated Next type imports are restored;
frontend source is preserved. Source/evidence are prepared on `feat/d3-native-task-bootstrap`.

The task factory still needs the executable image entrypoint and real image-owned provider/TLS/
subject/kernel configuration. Managed IAM/routing, task/image conformance and actual candidate
client/ATS/provider/accountable acceptance remain; library/local scenarios do not complete D3.
