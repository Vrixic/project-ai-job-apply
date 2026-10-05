# Native temporary material process

Source/local evidence only; no production launcher, bound endpoint, cloud deployment or activation.
See [proposed ADR-040](../../../../docs/adr/040-native-temporary-material-processes.md).

`kernel-deadline.c` is a Linux Node-API module for a dedicated material-bearing process. Load it
only after private launch admission and the default-off switch have passed. Loading it immediately
arms a 60-second boot expiry and disables core dumps/dumpability. Its three scalar capabilities
can shorten boot time, bind original completion exactly once, or request immediate termination.
Absolute realtime and monotonic timers kill this process independently of the JavaScript event
loop. No method disables or renews a deadline. Reload/worker initialization and invalid binding
fail by terminating this allocation. Do not load it into a shared API, Lambda, browser or pool.

Documents' private `./native-memory-session` factory pins one candidate/application/generation,
uses the real original actor and scalar SDK completion observation, and refuses a second session.
Its disposal capability requests native retirement and cannot return a death acknowledgement.
The separate trusted process/task observer must supply that positive evidence; provider work is
never settled by kernel death. Production owner/control ports must be authenticated and approved.

Run the explicit Linux test with a running Docker engine and an existing immutable Node 24 image
that includes GCC and Node headers:

```powershell
node scripts/verify-native-memory-session.mjs --enable-local-linux-tests --image sha256:<local-image-id>
```

The verifier never pulls an image, disables container networking, mounts only copied test inputs
read-only, compiles into bounded tmpfs, checks process SIGKILL rather than a timer flag, and removes
only its exact owned container/staging directory. Keep Docker/WSL stopped after the final needed
Docker step. Build image, architecture, compiler, native module integrity and managed-runtime
conformance remain release requirements; the local build is not a published production artifact.

Tests use synthetic candidate facts and injected provider/SQL/renderer ports. SDK grounding and
material-memory reads are real. `fixture.mjs` is test-only, emits scalar proof metadata only and
must never be a production entrypoint. No real candidate files or credentials are allowed.

The expanded explicit Linux test also exercises the private native HTTPS read factory in the
same kernel-bounded process. A synthetic trusted certificate/hostname and signed test JWTs cover
read formats, token/scope/owner checks, strict requests, CORS, packet revocation, pending-call
admission and actual disconnect. Synthetic TLS keys exist only in bounded test tmpfs. No server
certificate verification is disabled. Provider/SQL/render/managed OIDC remain simulated; the
owning scalar proof and HTTPS session are actual source. This is not production routing or an
authenticated private remote owner adapter. See
[transport evidence](../../../../docs/product/delivery/evidence/d3-native-memory-transport-2026-10-05.md).

The connected HTTPS fixture now uses the actual fixed-origin scalar authorization client, with
signed candidate tokens verified again by a simulated Gateway fetch port and the actual owning
scalar helper. SQL view/provider/renderer/managed OIDC remain synthetic in that fixture. Direct
preview/file responses are validated against existing public schemas; production test-verifier
injection is refused. Separate real PostgreSQL/Gateway HTTP cases cover actual authenticated
metadata ownership and original completion. These proofs do not establish deployed end-to-end
routing, an enabled client or positive AWS task retirement.

The separate Documents `./native-task-retirement` control client can observe one trusted bound ECS
task's terminal state, without content or local process acknowledgement. Its scalar receipt is not
application-wide disposal or remote-provider settlement. It is source-only/default-off; owning
registry/sealed admission, managed IAM and actual AWS task conformance are not implemented. See
[retirement evidence](../../../../docs/product/delivery/evidence/d3-native-task-retirement-2026-10-05.md).
