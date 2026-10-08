# Native cover-letter approval with PostgreSQL — 2026-10-07

Local composition check passes against backend runtime `5fe0a92e`. This adds verification only;
no production implementation, migration, deployment or activation changes.

## Executed path

The real Applications runtime creates an application and initial packet in PostgreSQL. The real
Linux native session verifies a synthetic provider answer against a confirmed synthetic fact and
holds the resulting cover letter in process memory. Its actual reference is attached to a packet
through the owning Application store. Approval uses the production Gateway availability client,
real TLS 1.3 HEAD transport, signed test identity and current-packet authorization through the
real Applications API/store. The scalar authorization callback is in process; this does not prove
hosted Gateway HTTP routing or managed OIDC.

Assertions cover refusal without a request-scoped credential before any approval is persisted,
successful credential-bound approval, repeated current-packet authorization during the native
read, the exact persisted packet hash, approval expiry matching the native original expiry, and
withdrawal of availability authority. No generated body is downloaded by the Gateway.

Provider calls, KMS responses, Profile/Jobs ports, work/completion authorities and rendered file
bytes are synthetic. Real SQL, production packet protection logic, native generation/verification,
kernel lifetime binding, HTTPS transport, availability client and approval persistence execute.
This is not the full managed preparation workflow, real document rendering, real-candidate
acceptance, tailored-resume approval, ATS submission or production clearance.

## Local environment and result

- PostgreSQL 16.14 in a disposable tmpfs container with network mode `none`.
- Test process shares only that container's network namespace; no external network is available.
- Node 24.21.0 Linux compiler image, selected by local digest
  `sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4`.
- Profile migrations through 0011, Documents through 0016 and Applications through 0012 apply
  and replay through their production migration entry points.
- Final run prints `native-postgresql-approval:ok`; log `.tmp/native-postgresql-approval-final.log`.
- The three new harness files pass Biome check. Existing kernel suite is unchanged.

Runner: `scripts/verify-native-postgresql-approval.mjs --enable-local-approval-test --image
<local-sha256> --database-container <exact-container-id>`. The database must be running, labeled
`codex.task=native-approval`, use network mode `none`, database `native_approval`, and the explicit
synthetic fixture credentials checked by the runner. The runner removes its own test container
and checked staging directory. Its caller owns database cleanup; this run removed the disposable
database and stopped Docker/WSL afterward. PC remains on.

D1/D3 remain In progress. Full managed preparation/approval, resume composition, refreshed release
artifacts and the existing deployment/client/ATS acceptance requirements remain unfinished.


## Tailored resume and packet replacement

The same isolated runner now executes cover-letter and tailored-resume checks in separate native
processes. Both pass on PostgreSQL 16.14 and Linux Node 24.21.0. The resume case uses the real
native tailoring session and its actual PDF/DOCX rendering/verification on a synthetic base
resume. Source/admission/completion authorities, KMS, catalog/Profile and signed identity remain
synthetic. This does not exercise the managed generation ledger workflow or hosted HTTP callback.

Both cases also reopen the approved application and prepare a replacement packet through the
owning API. The old material's TLS HEAD request is refused and SQL has no current approval.
The original expiry remains the successful approval's exact expiry. Output:
`native-postgresql-approval:cover_letter:ok` and `native-postgresql-approval:tailored_resume:ok`.
Log: `.tmp/native-postgresql-both-approval.log`. PDF text verification passes despite the known
optional canvas/Path2D warnings in the bundled test environment; no canvas rendering is claimed.
The three changed harness files pass Biome check. No production code changed.
