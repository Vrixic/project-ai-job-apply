# D3-064: one-off generated-material backend enforcement

Status: In progress. Started 2026-10-04. Fresh main `e48bdf3a10e3813d1d62590eea267dd0267ce22a` contains the accepted owner policy in [ADR-038](../../../adr/038-one-off-generated-application-materials.md). Exact open #547 source `25f0ca0506cb5389b16290ed54e8fd3b34aface5` is integrated in isolated branch `feat/d3-temporary-material-runtime`. Backend only; source/default-off; nothing deployed or enabled.

## Required end state

Generated cover letters and improved/tailored resumes exist only in bounded temporary memory and expire by 1,800 seconds after generation completion. Reads, downloads, edits, retries and approval cannot extend that deadline. Expiry, cancellation, logout, memory loss and confirmed submission discard platform copies; memory loss cannot recover a persisted draft. Generated material never enters SQL/packet/idempotency/history/export, objects, durable state, queue, logs or persistent browser storage. Hashes/minimal metadata may persist for reviewed approval and duplicate prevention. Confirmed/ambiguous technical submission state is preserved. D3-012 must verify provider retention/no-training terms; active writer settlement remains positive-proof only. Browser and deployed acceptance remain separate gates.

## Integration and identifier reconciliation

Main's accepted ADR-038 remains unchanged. The unaccepted vault-admission proposal formerly numbered 038 moves to [ADR-039](../../../adr/039-transactional-vault-reference-admission.md). The open stack's isolated-provider bootstrap formerly labeled D3-064 is now D3-078 in the current task register; historical logs retain their original identifiers and are interpreted with this mapping. Owner D3-064 names the new retention policy. D3-077 restricted candidate-authored packet-value protection is a separate unfinished task.

The source merge reconciles main's original-provider terminal settlement with the later immutable failure-proof path. A duplicate method from the merge is removed; the proof-recording method and unchanged pure metadata validators are retained. Workflows/dependency production build passes. Full maintained and transactional tests remain pending; previous #547 results do not verify this combined source.

## Backend enforcement path

AI helper with original generation purpose → refuse one-off material as a persisted proposal → Applications permits only the exact bound artifact digest in document fields → owner SQL check refuses plaintext/mismatched references → candidate receives fixed value-free validation failure. Ordinary narrative answers and candidate-authored non-document answers retain their separate policies. Tests must prove metadata-only pointers remain usable, direct SQL cannot bypass the document guard, and failed requests leave packet/history/outbox/idempotency unchanged.

Full temporary-memory/provider transport replacement and expiration/admission integration remain necessary; this record does not redefine the end state around persistence guards. Existing saved draft/private S3/provider-slot paths remain contrary to ADR-038 and cannot be activated. No retained synthetic versions are certified erased. No frontend edit, live model/ATS call, hosted CI monitoring or production approval is claimed.
