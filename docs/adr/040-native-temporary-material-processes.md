# ADR-040: Native temporary material processes

Status: Proposed; default-off source and local kernel evidence only
Date: 2026-10-05

## Context

[ADR-038](038-one-off-generated-application-materials.md) limits generated material to bounded
memory for at most 1,800 seconds from original completion. The original actor and held-copy
read path enforce logical lifetime and clear controlled buffers. JavaScript timers cannot act
while their event loop is blocked, and Lambda freeze prevents evidence of proactive idle cleanup.
The content process therefore needs a resource envelope ordinary Lambda cannot supply.
[ADR-016](016-scale-to-zero-application-runtime.md) permits explicitly on-demand containers for
such requirements and still forbids always-on gateways, general workers or pools.

## Proposed decision

Use one dedicated Linux process in an explicitly started, bounded on-demand task for one
candidate, application and original generation. Keep private owning SQL/control activities in
the accepted Lambda control plane; the material process has injected authenticated owner and
scalar claim/settlement/completion ports, no database credentials or generated object access.
Do not load the native deadline module into a shared API process, Lambda or browser.

Before candidate content is admitted, load the Node-API deadline module. Initialization arms a
60-second kernel boot deadline and disables core dumps and process dumpability. The session
factory only shortens startup time, refuses another allocation in the same process and refuses
worker-thread allocation. A synchronous scalar SDK observation binds original completion before
decoding, grounding, control acknowledgements or rendering. The first valid binding replaces
startup expiry with a deadline no later than completion plus 1,800 seconds. Realtime and
monotonic absolute timers signal SIGKILL to the material process; either can expire first.
Reads, edits, retries, rendering and approval do not renew it. Repeat binding or module/worker
reinitialization retires the process rather than granting new authority. Limits may be lowered.

Cancellation/logout/confirmed submission must clear controlled memory and request process
retirement sooner. A process cannot positively acknowledge its own death: the separate trusted
process/task observer must observe the exact allocation terminal before returning a native
cleanup acknowledgement. Requesting termination, expiry or losing an HTTP response never settles
remote provider work or grants candidate-rights purge authority. Unknown provider work remains
unresolved; confirmed and ambiguous submission evidence and duplicate guards remain intact.

The production task must use a reviewed immutable Linux image, read-only filesystem, bounded
memory/CPU, no generated scratch files or content-bearing logs, no debugger/ECS Exec, and no
separate rendering child processes. Existing PDF/DOCX rendering uses in-process memory. No
content-bearing sidecar, shared pool, ALB, NAT gateway or Redis is introduced by this proposal.

## Transport and activation gates

This source defines process lifecycle, not an authorized production content endpoint. The
launcher, exact scoped task registry, authentication/IAM, TLS/DNS routing and native stop observer
remain unimplemented. The selected content path must keep generated bodies out of frozen Lambda
copies: the existing Gateway content tests prove local ownership/HTTP checks, not such a native
production transport. Gateway/durable control can retain scalar references and authorize access;
review the complete content path before enabling it. Browser cleanup and ATS handoff still need
separate evidence. Do not enable an endpoint simply because the Linux process test passed.

D3-012 no-training/retention/diagnostic/entity/region approval remains mandatory before any live
provider. D1/D3 are not complete. This proposal does not authorize a deployment or new public
hostname, and does not reinterpret the owner policy as reusable or saved material.

## Evidence and tradeoffs

The Linux test compiles the C module with strict warnings, bundles the actual SDK/actor/session,
and observes child exit signals. It exercises idle/busy/suspended processes, unsettled control,
cancellation, repeat binding, invalid clocks/limits and module/worker reinitialization. Provider,
SQL and renderer ports are synthetic for this kernel test; prior connected SQL/render/HTTP
proof remains separate. No live AWS task, provider or installed-client acceptance follows.

The native module adds a small Linux-specific build and review surface. It is justified by
an independently observable process lifetime that event-loop callbacks cannot provide. Keep
this boundary small and value-free, rather than placing document logic in C.

Implementation uses [Linux absolute POSIX timers](https://man7.org/linux/man-pages/man2/timer_settime.2.html)
and [Node-API](https://nodejs.org/api/n-api.html). Native timer behavior on the selected managed
runtime, exact image/architecture, task failure/stop and external-copy cleanup must be verified
before activation. Local process exit covers the tested process, not remote systems or another
allocation.

## Source transport checkpoint — 2026-10-05

A default-off dedicated HTTPS factory now implements exact OIDC issuer/subject/audience/scope
with required expiration, fixed session/application/generation reads, TLS 1.3, exact client-origin
CORS, bounded admission and no-store responses. Private Applications supplies a scalar current
packet/reference proof that is checked again after source/render awaits; token verification is
also repeated before sending. Generated content remains in the native process on this path.
Only a trusted launcher may bind the listener. This does not implement or authorize issuer/
launcher admission, authenticated remote owner/control adapters, task registry, managed TLS/DNS
routing, positive managed stop or the complete browser/ATS content path. Existing Gateway/Lambda
copies remain outside this proof. The proposal remains Proposed; D3-012 and release gates are
unchanged. [Local source evidence](../product/delivery/evidence/d3-native-memory-transport-2026-10-05.md).

## Scalar owner authorization checkpoint — 2026-10-05

A default-off scalar Gateway route can now reuse the current verified candidate access token and
normal identity/owner checks to return current packet/reference metadata. The dedicated native
client pins the approved HTTPS origin, validates bounded original metadata and never retrieves
or forwards generated bodies through Gateway/Lambda. Native reads repeat this proof; no new
credential issuer is needed merely for this owner read. Launch admission and private evidence/
work/completion adapters, allocation registry, managed routing/stop and complete client/ATS
content routing remain gates. Existing Gateway body routes are outside this native path's proof.
No production flag/hostname, deployment or provider is activated. The proposal remains Proposed.
[Source evidence](../product/delivery/evidence/d3-native-read-authorization-2026-10-05.md).

## Trusted task retirement checkpoint — 2026-10-05

A private default-off control client now pins one immutable allocation/task and uses signed ECS
DescribeTasks/StopTask. Only a fresh exact terminal task/container description supplies a scalar
retirement receipt. A stop request, missing task, timeout, abort or native-process reply does not.
The actual owning registry/sealed launch admission and durable receipt composition, reviewed IAM,
managed task conformance and full application-wide disposal remain gates. There is no generated
content, SQL, launch/list or provider-settlement capability on this path. This source does not
authorize a cloud call, deployment, activation or physical all-copy purge. The proposal stays
Proposed. [Local evidence](../product/delivery/evidence/d3-native-task-retirement-2026-10-05.md).

## Owning allocation checkpoint — 2026-10-05

Default-off Documents metadata now records original launch intent before any future RunTask and
can durably bind a late actual launch capture. Applications supplies owner/status locking in the
same transaction. Sealing blocks new original work claims; fresh generation requires an explicit
previous epoch and a grant issued after sealing. Durable exact-task proof plus a final sealed-epoch
check supplies native-task disposal acknowledgement, with no SQL lock over AWS or provider-work
settlement. Pending unknown launches remain unresolved and block deletion/fresh generation.
Private launcher/RPC/IAM/image/routing/managed-task and complete client/ATS/provider/accountable
gates remain. This checkpoint is source-only and does not enable a runtime, certify all-copy purge
or accept this proposal. [Evidence](../product/delivery/evidence/d3-native-material-registry-2026-10-05.md).


## One-attempt launch source checkpoint — 2026-10-05

The private control factory now verifies exact signed task-definition/image/envelope metadata,
consumes one durable Documents launch claim under Applications same-transaction admission,
then issues one RunTask with no held SQL locks. Original claim/launch/capture ambiguity never
permits another launch, including beyond the finite ECS client-token lifetime. Late fulfilled
capture and positive exact-task recovery preserve sealed/quarantined drain, with new launches
independently disabled. Pending unknown launch deliberately withholds disposal/fresh generation;
negative-dispatch disposition and durable managed event capture still require design/composition.
Local SQL, emitted isolation and logical restore evidence do not implement or authorize the
native image, authenticated private adapters/launcher, TLS routing, IAM or managed conformance.
This proposal remains Proposed and all activation/accountable/provider gates remain open.
[Evidence](../product/delivery/evidence/d3-native-task-launch-2026-10-05.md).
