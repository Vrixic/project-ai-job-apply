# D3-079 native memory-session process — 2026-10-05

Status: In progress; default-off backend source/local process evidence, undeployed.

Started on freshly fetched main `e48bdf3a` plus exact open #554 `50a9965a`.
[ADR-038](../../../adr/038-one-off-generated-application-materials.md),
[ADR-016](../../../adr/016-scale-to-zero-application-runtime.md) and
[proposed ADR-040](../../../adr/040-native-temporary-material-processes.md) define scope/gates.
D1/D3 remain In progress. CI/CD remains deferred until production launch by the owner.

## Implemented source

Original private allocation → one immutable candidate/application/generation → real SDK original
foreground call → synchronous scalar original-completion observation → one-time native deadline →
existing grounding/scalar completion/managed memory. The kernel receives no content or authority
to issue/renew grants, settle remote providers, access SQL/objects, or acknowledge its own death.

The Linux Node-API module immediately arms 60-second boot expiry and disables core dumps and
process dumpability. Limits can only shorten startup or select at most 1,800 seconds from original
completion. Absolute realtime and monotonic SIGKILL timers do not depend on the JavaScript event
loop. Repeat binding, invalid/future/expired clocks, excess limits and module/worker reinitialization
terminate the allocation. The session defaults off, rejects non-Linux/shared-worker/second session
admission, scopes every reader to the fixed owner/application, and requests native retirement on
scoped disposal. No death acknowledgement is returned; task/process observation must be separate.
SDK observer errors withhold content without retry or ordinary/background observer invocation.

No public schema/route, migration, frontend, infrastructure, deployment or activation change.
The private Documents export adds a dedicated session subpath; production bootstrap/transport are
not composed. Restore inventory remains 63 migrations, seven owners and 84 relations.

## Local evidence at source start

- Eight SDK original-completion tests pass, including two new observation/failure cases.
- Three Documents focused files pass 49 cases, including default-off and non-Linux refusal.
- Initial corrected Linux run passed 13 real child-process cases. The expanded run passed 14
  including scoped cancellation. Final second-allocation case/native rerun and full maintained
  verifier are pending at this source start record.
- Local Linux test image: `sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4`,
  Node 24.21.0, GCC, Linux AMD64 under Docker Desktop/WSL. Host repository checks use Node 24.12.0
  and pnpm 10.24.0. The native test never pulls, has networking disabled, mounts copied synthetic
  inputs only, and compiles with `-Wall -Wextra -Werror` into bounded tmpfs.
- The tests run actual SDK grounding/session memory and observe actual SIGKILL for idle/busy/SIGSTOP,
  pending settlement/startup, early cancel, repeat/invalid binding and reload/worker initialization.
  Original reference expiry remains completion + 1,800,000 ms; shortened test kernel limits retire
  earlier. Parent fallback is not passing evidence. Provider/SQL/renderer ports are synthetic,
  not live provider or native SQL proof. Prior connected SQL/render evidence is separate.
- Initial native run failed because tmpfs code execution was disallowed. That test-mount setup was
  corrected; the failed run is not kernel evidence. Focused lint caught unsafe cleanup error flow,
  which was corrected with separate checked cleanup and aggregate failures.

## Remaining delivery gates

Native image/architecture integrity, authenticated private issuer/launcher/transport, process/task
registry and positive managed stop observation, production rendering in the native image, and
complete content routing remain unimplemented. Existing Gateway local content checks do not prove
physical cleanup of frozen Lambda copies. No model/ATS/AWS call or deployment occurs here.
D3-012 approved provider terms, temporary resumes/candidate edits, workflow/ATS handoff, idle
browser/logout cleanup and installed-client/deployed/accountable acceptance remain open. Do not
reopen removed Delivery queue/Your shared jobs manual panels. D3-077 reuse protection stays open.
Process retirement covers only its allocation; it does not settle provider work, prove another
copy purged, delete a candidate-held download, or erase confirmed/ambiguous evidence.
