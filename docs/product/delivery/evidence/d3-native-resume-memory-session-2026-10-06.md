# D3 native deterministic resume memory session — 2026-10-06

Status: default-off source and local process evidence; D1/D3 remain In progress.

ADR-038 includes tailored resumes in the absolute 30-minute one-off policy. The existing
ADR-031 synchronous Lambda tailoring path recomputes on each hash/preview/file read; it does
not establish original completion or a kernel-bounded idle process. The existing native source
serves cover letters only. This batch starts the missing resume path using the actual deterministic
tailor, factuality checks, source-derived diff and in-process PDF/DOCX render verification.

The private `./native-resume-session` factory is dedicated Linux/main-thread/default-off source.
A shared one-time process claim now covers cover-letter and resume factories; a second kind or
allocation cannot share the content process. The trusted launcher must already load the actual
kernel and provide authenticated owner admission, original source and completion ports. No
listener, provider/model, work-grant issuer, SQL, object client, public route or death receipt is
created. Existing native cover-letter composition and ordinary Lambda tailoring stay distinct.

The session captures strict data-only UUIDv7 owner/application/generation/base identity, original
base version/hash and canonical job-context digest. Source and completion methods are captured
before awaits. Owner admission is checked around source retrieval and subsequent async boundaries.
The normalized original must match the captured base; job title/description must match its digest
and bounds. Tailoring only reorders/omits original source nodes and passes existing factuality.
Source original content has its separate retention policy; generated views are not saved with it.

Generation is attempted once. After synchronous materialization/hash/view, the original completion
clock binds the kernel synchronously before serialization, private acknowledgements or rendering.
The reference uses existing tailored_resume scalar metadata and completion plus exactly 1,800,000ms.
Tests may shorten only the process budget; reads and repeated generation never renew it. The
bounded store stages encoded preview/render inputs privately, requires original completion claim
and verifies both file formats before publishing. Unknown/pending acknowledgement publishes
nothing and cannot move the kernel deadline. Generation failure terminates the process without
claiming its own death or remote settlement. Original completion authority and owning restart
fences must still be implemented for resume before activation; tests inject that authority.

Reads require the exact original store reference and repeated owner admission. Preview/file
responses retain an active process-local lease with explicit release and revalidation; these
callbacks are private capabilities, not serializable wire fields. A file read renders the held
original blocks and verifies extracted text, without loading the source or regenerating tailoring.
Held file bytes and preview arrays clear on release, request abort or lease abort; expiry/request
checks withhold stale outputs. Actual process death bounds idle/busy copies independently of JS.
Caller-held downloads and external copies remain outside platform cleanup. Future transport must
supply authenticated current packet checks, no-store and final response revalidation.

Initial local evidence:

- Documents build passes after correcting a parser import and explicit never-return failure path.
- Four focused default-off/accessor/legacy session checks pass; no simulated Linux platform claim.
- Five emitted native composition checks pass. New resume bundle contains actual memory/tailoring/
  render/parser code but no model, SQL, AWS object/client, cover-letter generator or session module.
- All 37 actual Linux child-process scenarios pass in the existing immutable Node 24/compiler
  image, with native module freshly compiled into tmpfs and network disabled. Four added scenarios
  exercise resume idle, synchronous busy loop, immediate termination and unresolved original
  completion. They verify actual PDF/DOCX reads and releases, preview release/cancellation,
  wrong-reference/admission refusal, captured identity, no repeated source/generation/completion
  and cross-kind admission refusal. Parents observe SIGKILL before fallback. Existing 33 cover/
  transport/image-source/bootstrap scenarios remain passing. Actual source/memory/render/kernel
  behavior is real; source/owner/completion authority is generated synthetic and not SQL/AWS.
- Compiler image lacks optional canvas support; the unchanged two exact parser startup diagnostics
  are permitted for this source-only harness. Unknown/content diagnostics and fixture candidate
  text in stdout are refused. No production-image or managed-conformance acceptance follows.

Initial logs: `.tmp/d3-native-resume-{build,units,bundle,linux}.log`. Final 37-case rerun after fixed
admission-error projection and captured callback changes also passes, with no failures/skips and
actual kernel retirement. Log: `.tmp/d3-native-resume-linux-final.log`. Full clean-source
verification follows. No changed production image is built or published by these source tests.

Resume-owned original completion/restart metadata, current packet preparation/reads, private owner
RPC/source/bootstrap, authenticated HTTPS/direct client path, actual production image, managed
routing/stop, client idle cleanup, ATS handoff and accountable/provider approval remain required.
The ordinary tailoring Lambda is not silently redirected to this incomplete path. ADR-040 remains
Proposed, ADR-038 enforcement remains unfinished, and D1/D3 are not complete. No SQL migration,
public contract, frontend feature, deployment, activation, main merge, PR or hosted CI/CD work.
PC stays on; Docker/WSL stop after the immediately required Linux work.

The owned Linux verifier removes both exact containers and invocation staging directories on
completion. Docker/WSL are stopped; shared volumes remain. Only the owning isolated web parent
and child are stopped before full verification reserves localhost:3000. Restore the maintained
web afterward. No PC shutdown is performed.

## Full clean-source verification

Frozen clean source `b849cac40c90c5901b2bc791900fc9b937411e90` passes the original
`scripts/verify-phase0.ps1` run with matching ARTIFACT_SOURCE_SHA and exit zero. All 38 typecheck
tasks, 39 test tasks and 23 production builds pass, along with operator/security/formatting/Compose
and emitted isolation checks. The new resume memory/render dependency isolation passes in the
full run. Lint remains zero errors, 15 warnings and 58 infos. Tracked source stays unchanged while
the original verifier is alive. Log: `.tmp/d3-native-resume-full.log`.

This complete repository check is separate from the 37 real Linux child-process scenarios above.
It does not execute a new production image or managed native task. No persistence implementation
or actual owner-SQL completion claim for resume is implied by injected process fixture ports.

The maintained development web launcher restores the isolated app against the live development
API. Anonymous root returns 200 and `/resume` returns 307 with redirects disabled. Only Next's
two generated development type imports are restored after exact diff inspection. No frontend
feature or new authenticated acceptance is asserted; owner-confirmed Profile/save/reload steps
are not repeated. Docker/WSL remain stopped, shared volumes retained and the PC stays on.

## Next owner integration boundary

Current `PostgresTemporaryMaterialCompletionStore` accepts cover_letter only, tied to a running/
settled original provider_dispatch grant. `PostgresNativeMaterialRegistry` also binds cover-letter
work and Documents cover-letter rows. Applications' `readNativePreparationBootstrap` explicitly
checks OpenAI cover-letter purpose, consent notice, model and categories. Those are not generic
deterministic-renderer authority and cannot be silently repurposed for native resume generation.

Resume needs an owner-issued original-generation record binding the active candidate/application,
selected immutable base resume/version/hash, canonical job context and current application revision.
Its original completion/restart fence and exact native task allocation/retirement must be composed
before readiness can enter a packet or a trusted content endpoint. Then connect current packet
metadata and authenticated direct reads without generated Lambda body copies. These are existing
D3-064/D3-079 requirements, not completed by the local session or by this full verifier. Source
inspection clarifies that next integration step; all managed/provider/client/ATS/accountable gates
remain open. D1/D3 stay In progress.
