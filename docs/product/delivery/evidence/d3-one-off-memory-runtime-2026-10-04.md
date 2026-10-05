# D3-064: Documents temporary-memory replacement

Status: In progress. Started 2026-10-04 in backend-only isolated branch
`feat/d3-one-off-memory-runtime`, from fresh main `e48bdf3a` plus exact open #548
`ccc89cc3`. Accepted [ADR-038](../../../adr/038-one-off-generated-application-materials.md)
is unchanged. The preceding [persistence checkpoint](d3-one-off-generated-material-guards-2026-10-04.md)
remains an explicit dependency. This record covers a new Documents content boundary, not completion
of D3-064 or either phase.

## Required end state and this path

The entire owner policy remains required: bounded temporary content for cover letters and all
improved/tailored resumes, a non-renewable maximum of 1,800 seconds from original generation
completion, early discard on logout/cancel/confirmed submission, no persisted copies, idle client
cleanup, no-store responses, packet invalidation and final ATS-handoff checks, safe regeneration
with new review and edits that inherit the original deadline, preserved confirmed/ambiguous submission evidence, and D3-012 approved provider
retention/no-training terms. Original resumes and candidate-authored answers retain separate policy.

Original validated generation + exact completion metadata -> temporary staging -> original
completion authority -> current owner evidence + both verified formats -> publish memory-only
content -> exact generation reference for binding/preview/file -> recheck after async work ->
return content only inside its window. Completion returns hashes/citations and closed scalar
reference metadata only. No SQL, S3, provider call, durable state, queue, export or reconstruction
capability exists on the new content store/read service.

`TemporaryMaterialStore` has a 16 MiB cap for managed encoded and borrowed buffers, at most
128 entries including cancellation tombstones, 2 MiB per material and 16 concurrent borrows.
Configuration can lower, never increase those ceilings. Capacity pressure refuses admission,
without evicting an approved material. Cover-letter encoding separately remains at 32 KiB,
with at most six bounded paragraphs and 300 KiB rendered files.

Staged content is unreadable until verification finishes. References bind kind, owner,
application, generation ID, version, content hash and original completion/expiry. Identical text
under a replacement ID cannot satisfy the old reference. Reads/verification/retries cannot extend
stored deadlines. Wall and monotonic deadlines both apply; clock rollback/failure closes admission
and discards managed content. Timers actively clear idle buffers; every admission/read and return
checks expiry, including when a cleanup timer has not run. Cancellation scopes preserve neighbors.
Discard zeroes managed buffers and active byte copies, clears managed decoded paragraph references,
and aborts active borrows. Discard tombstones prevent restoration within the original window.

The completion-authority port must atomically consume the original durable completion and verify
exact immutable metadata. Missing/refused/already-completed authority cannot publish content.
A restarted store has no content or recovery port. The simulated owning authority proves contract
refusal of renewed timestamps and same-generation reconstruction; no native SQL/RPC authority is
implemented or verified in this checkpoint. It must precede activation. Hash-only metadata/read
replay does not confer new generation authority or settle an ambiguous remote writer.

## Rendering correction

Focused tests exposed PDF.js transferring/detaching the renderer buffer during verification,
leaving the subsequent download without bytes. Production verification now supplies a separate
scratch copy; the artifact remains nonempty and matches its SHA-256. Scratch bytes/parsed-block
references are released after verification. Cover-letter rendering clears its transient bytes,
block text and preview copies on success/failure/abort, rechecks cancellation after async work,
and returns fixed errors. DOCX and PDF still pass the production parser before publication.

## Verification and remaining work

All 1,231 Documents unit tests pass, including 57 new memory/completion/read cases. Focused
memory/read/render checks and Documents production build/typecheck pass. Full maintained
verification remains pending. All 57 general Documents
real PostgreSQL cases pass against owned tmpfs PostgreSQL 16.14 at loopback port 55448; the 260
opt-in ledger cases are skipped in this run and not counted as executed. No SQL migration,
shared API/event/domain schema, restore manifest or cloud configuration changes in this step.
The previous 61-migration/84-relation identity stays unchanged. Workflow units pass 1,588 cases;
57 opt-in workflow integration cases are skipped. Original input/normalized reads and relevant
provider/object/KMS transports are simulated in unit tests; no live provider, AWS, ATS or user
artifact is used.

Managed store cleanup is not a secure-erasure claim for arbitrary caller copies, garbage-collected
strings, frozen/suspended runtimes, or an uncooperative parser/provider. Native completion metadata
and transport/routing, cooperative/hard worker cancellation and positive settlement/drain,
generated resume integration, packet expiry/approval/submission admission, lifecycle hooks,
no-store HTTP transport, client idle/logout cleanup and approved provider retention remain open.
Existing S3 draft/provider-slot creation/recovery/export paths remain contrary to ADR-038 and
cannot activate. Old retained synthetic object versions are not certified erased. No native
replacement artifact is published or deployed. No UI was changed or exercised, and no human/live
end-to-end acceptance is claimed. Keep D3-064 and D1/D3 In progress; hosted CI/CD remains deferred.


## Async context probe and final source preparation

The first full verifier passes clean `58db6db2` (38 typecheck tasks, 39 test tasks, 23 builds,
unchanged lint and operational/compiled-isolation checks). A separate actual compiled-service
probe with simulated original-completion authority/renderer demonstrates a late-context race:
changed evidence during rendering initially returned a download even though a fresh binding
read refused it. Completion and file reads now reload current owner context after async rendering
before publication/return, and clear refused output. The same compiled probe now reports
`lateReadAllowed: false` and `currentBindingRefused: true`. Three new regressions cover changed
context during verification/download and active expiry while the final context read is stalled;
rendered output is cleared before that read returns. All 1,231 Documents units and build pass.
This remains a point-in-time context check, not cross-owner fact-version serialization or final
ATS-handoff approval. Full exact-source rerun remains pending the final context fix.


## Final maintained verification

Exact clean implementation source `1df42237a59c64eecb15f5d796502514ade06f0e` passes
`scripts/verify-phase0.ps1`: 38 typecheck tasks, 39 test tasks, 23 builds, contract generation,
formatting, dependency-security, operational/operator, Compose and compiled private-isolation
checks. Lint stays at zero errors, 15 warnings and 58 informational notes. Documents units are
1,231, including 57 new cases. The compiled context probe refuses late content; no simulated
native completion authority is described as real SQL proof. Separately executed SQL counts and
skips above remain accurate. The contract-generation pass leaves the tree clean, current restore
identity is unchanged, and added local Markdown links resolve. Accepted ADR-038 is unchanged.
Only delivery records change after this verified implementation source. Owned PostgreSQL fixture
is removed, Docker Desktop/WSL are stopped and shared volumes are retained. No current-source
native memory artifact, publication, deployment, activation, browser or live authenticated/model/
ATS acceptance is claimed. D3-064 and both phases remain In progress; no exit checkbox is changed.

Next backend step implements immutable original-completion metadata admission and its qualified
private RPC before composing the memory boundary. It must verify original dispatch ownership,
serialize one-time completion, reject refreshed timestamps, and refuse same-generation restoration
after memory loss without claiming writer settlement. Then integrate generated resumes, exact
packet references and expiry at approval/submission handoff. Transport/no-store, lifecycle/client
cleanup, native worker drain and provider-retention acceptance remain required under ADR-038.
