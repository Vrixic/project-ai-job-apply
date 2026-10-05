# D3-064 original memory-only cover-letter generation — 2026-10-05

Status: In progress; backend source and local evidence, default-off and undeployed.

Started from freshly fetched main `e48bdf3a` with exact #553 `467b48eb` fast-forward
integrated. [ADR-038](../../../adr/038-one-off-generated-application-materials.md) and
[ADR-016](../../../adr/016-scale-to-zero-application-runtime.md) govern this replacement.
D1/D3 remain In progress. Hosted CI/CD is deferred until production launch by the owner.

## Implemented path

Private owner evidence → canonical request hash → consume existing native dispatch grant →
one foreground SDK invocation → capture original completion clock → grounding → positive
scalar provider settlement → native original completion → temporary memory → existing packet/
HTTP read and terminal disposal. No provider slot, generated object, saved recovery or durable
content is used by this actor. The private issuer remains a separate composition requirement.

- `OriginalCoverLetterGenerationActor` defaults off and receives only narrow injected owner,
  claim/settlement and temporary-completion/discard ports. It cannot issue/renew work or access
  objects/SQL itself. Production owner/control ports must be authenticated; the test directly
  injects native owner implementations. The existing provider entrypoint exports the actor;
  its emitted bundle still excludes SQL, rendering and persistence runtimes.
- Canonical request bytes are memory-only and cleared after hashing. Original owner/application,
  context, disclosure purpose/version and fixed 15-minute consent are checked before disclosure.
  The original claim must match the request hash and native work identity; retries cannot invoke
  the original model again. Memory loss requires fresh preparation, never saved reconstruction.
- The SDK's new foreground-only `generateOriginalWithCompletion` captures completion time before
  output decoding and any actor control/render await. Existing receipt APIs retain their shapes.
  Its timeout requests cancellation while continuing to await the actual original provider port.
  Late fulfillment yields a value-free `completed_discarded` receipt. Throw/rejection/abort alone
  yields no settlement authority; one actor admits no replacement while its promise is pending.
- Positive invalid JSON/oversized fulfillment uses the existing rejection fence; locally proven
  non-dispatch uses the existing non-dispatch fence. Ordinary positive fulfillment settles only
  that provider phase. Neither record certifies provider retention, all-copy purge or host drain.
- Generated paragraphs are grounded before control settlement, then actively cleared at original
  expiry/cancellation even while a settlement acknowledgement waits. Completion rendering/native
  admission receives the same cancellation signal. Cancellation just after publication discards
  that exact new material. Rendered validation files remain transient; no text leaves the actor's
  result, which carries hashes, fact identifiers and the original fixed-expiry reference only.
- The connected content SQL/HTTP fixtures now use the real SDK and OpenAI response parser with a
  simulated fetch response, original native grant claim/settlement/completion and production
  PDF/DOCX verification. A replay consumes no second model call. All existing stale-read, terminal
  disposal, idempotency and actual loopback socket-abort assertions remain in this path.

No public schema/route, migration, infrastructure, frontend, deployment or activation change.
Gateway's SDK dependency is development-only for the integration test; production imports remain
unchanged. Restore inventory remains 63 migrations, seven owners and 84 relations.

## Executed evidence

- AI SDK: 291 units pass, including six new original-promise/timestamp/late-discard cases.
- Documents: focused actor and temporary-completion files pass 47 cases, including 20 new actor
  cases. Actual SDK, canonical request hash, grounding and production rendering run in these tests.
  The initial full Documents suite passed 1,302 units before the final cancellation-race case;
  final full maintained verification remains pending at this source start record.
- Gateway: 23 real PostgreSQL/HTTP cases pass after replacing synthetic direct completion with
  original SDK dispatch/native controls. Final source rerun and native ledger checks are pending.
  OIDC, evidence-source fixtures and model fetch are simulated; no live model/ATS/cloud call.
- Relevant builds/typechecks and changed-file Biome checks pass. The isolated provider emitted
  dependency test passes. Test-only SDK dependency adds three lockfile lines without version changes.
- Focused compilation initially identified missing test dependency and stale emitted declarations;
  both were corrected. Earlier failed runs are not passing evidence.

## Remaining activation and phase requirements

A physically bounded native memory-session host, authenticated private issuer/transport,
process-wide admission, positive worker/renderer drain and maintained shutdown evidence remain.
Lambda freeze and JavaScript timers do not prove proactive physical expiry. Unknown provider
rejections remain unresolved native work, with no inferred remote stop or candidate-rights purge.
The host must retire an actor whose original provider promise never acknowledges.
D3-012 must approve no training, retention, diagnostics, entity and region terms before any live
provider is enabled. This source change does not self-certify those terms.
Temporary resume production/reads, same-deadline candidate edits, workflow/ATS handoff, idle
browser/logout cleanup, deployed installed-extension journeys, and existing accountable/ATS gates
remain open. Do not reopen owner-removed Delivery queue/Your shared jobs manual panels. The
separate D3-077 restricted packet storage gate remains open; saved-answer reuse remains false.

## Final local verification

Clean implementation `e8fdc2413f86466618ab5533abfba73cf3b675d3` passes
`scripts/verify-phase0.ps1`, terminal exit `0`: 38 typecheck tasks, 39 workspace test tasks,
23 builds, operational/security/Compose and emitted dependency isolation. Final AI SDK 291,
Documents 1,303 and Gateway 307 units pass; Gateway's 61 opt-in skips are not SQL evidence.
Lint remains zero errors, 15 baseline warnings and 58 infos. Local log/receipt:
`.tmp/d3-original-memory-verify.log` / `.tmp/d3-original-memory-verify.exit`.
No source changed while full verification was running; subsequent changes are documentation only.

Final source native rerun: all 23 Gateway original-SDK/native-control/memory/render/HTTP cases
pass. All 136 Documents native work-ledger cases pass with `COVER_LETTER_WORK_INTEGRATION=1`
and its dedicated `work_ledger_original_20261005` database. The earlier invocation skipped all
136 because its explicit opt-in was missing; it is not counted as persistence evidence.
Local terminal logs: `.tmp/d3-original-memory-http.log` and
`.tmp/d3-original-memory-ledger-optin.log`; both exit receipts are `0`.

Owned synthetic tmpfs fixture
`a150693ba1578407da509448438b786860a03b0b8f7329255974cc3aa7a6f2f0` was verified to have no
mounts and the exact `d3-original-memory-20261005` task label, then removed by exact ID.
Shared volumes were retained. Docker Desktop and WSL are stopped; no running WSL distribution.
All verification handles are terminal.

GitHub now reports #553 and the earlier stacked PRs merged into their respective branches;
Git and GitHub's authoritative `main` ref both still name `e48bdf3a`. The #553 review branch
still names exact `467b48eb`. This change is reviewed against that exact branch so its diff
contains the new original actor only; stack promotion to main is separate. No authored merge,
publication, deployment or activation occurred. D1/D3 remain In progress and all activation/
accountable gates above remain open. Owner CI/CD deferral remains in force.

2026-10-05 D3-064 original memory-only generation is reviewable in
[PR #554](https://github.com/Vrixic/project-ai-job-apply/pull/554), based on exact #553 branch
`467b48eb`. Verified implementation remains `e8fdc241`; subsequent commits change delivery
documentation only. D1/D3 and D3-064 stay In progress. No authored merge, deployment or activation.
