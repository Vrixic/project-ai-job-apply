# D3-064 temporary cover-letter owner reads — 2026-10-05

Status: In progress; backend source/local verification, no activation or deployment.

Started on freshly fetched main `e48bdf3a` and fast-forward integrated exact open #551
`2e171167`. [ADR-038](../../../adr/038-one-off-generated-application-materials.md) remains
authoritative. D1/D3 remain In progress. Hosted CI/CD is deferred until production launch
at the owner's instruction; this does not waive mandatory local checks or release approvals.

Path: authenticated HTTP → Applications owner packet/read admission → Documents narrow
process-local memory reader → production renderer → final packet/state/memory/deadline checks
→ guarded no-store HTTP response. No workflow, durable payload or content persistence is added.

The frozen Documents adapter exposes current/preview/file only. Bound packets never use legacy
saved drafts, regenerate content or re-tailor a bound resume. Each read checks exact private
nine-scalar reference, owner/application, hash, generation/version and original deadline. A
final SQL snapshot follows the last asynchronous availability check; a synchronous active memory
guard then refuses memory loss through serialization. Cancellation/applied state observed before
or during the read refuses. No SQL lock spans private I/O/rendering. Returned paragraphs/file
content are cleared on late failure. Public optional metadata contains seven scalars without
owner/application identifiers. Gateway checks before serialization and immediately before sending
serialized bytes, using fixed private-safe conflicts and `no-store`. Callbacks are never public.

Compatibility: old preview/file bodies remain valid; old strict consumers require upgrade before
new response producers. No query/route, migration, event, durable response or frontend change.
A read means the current owning packet, not historical generation selection.

## Executed focused verification

- Applications 202 units pass; 23 new exact-reference/read/expiry/race/lease checks.
- Applications real PostgreSQL: 91 pass, one separate opt-in skip, eight files.
- Gateway real PostgreSQL/HTTP: 47 pass across three files, seven new connected cover-letter
  cases. Original work authorization and immutable completion use actual native owner SQL;
  content uses actual bounded memory and production PDF/DOCX rendering. Generation output and
  OIDC tokens are synthetic; no model/ATS/network provider call occurs. Preview, both file formats,
  expiry, cancellation during read, lost memory and loss during sending pass. Stored document
  remains pending with scalar completion metadata; no generated object write/read is allowed.
- Documents 1,270 units pass in full verification; five Fastify serialization checks pass.
  Gateway defaults run 305 passing tests with 57 opt-in skips; Workflows run 1,588 passing
  tests with 57 opt-in skips. Opt-in skips are not counted as SQL/remote evidence.
- API generation repeats with SHA-256
  `3391959363ab7f0d2ad0f6a77462e480f7778670eb5be6bc0d670d9ec06bd4bd`.
- Clean `9da00ff8f49f70ef3dd3218e495997468a17b485` passes the full maintained verifier:
  38 typecheck tasks, 39 workspace test tasks and 23 builds, operational/security/Compose and
  emitted dependency/isolation checks. Lint: zero errors, 15 warnings, 58 informational notes.
  Local receipt: `.tmp/d3-temporary-reads-verify-final.log`, terminal exit `0`.
- The first full run on `56743f78` failed a test-only mock inference (`() => true` versus
  `() => boolean`). It is not passing evidence. Mocks now explicitly use the owner contract;
  the Applications build and all 23 new tests passed before the complete rerun.
  Production code is identical between the focused SQL source and the verified final source.
- The owned tmpfs-only fixture `28d47ed6c7d4d54120783fe056cca141642347b12c597ae3ae6a11298067a125`
  was inspected, removed by exact ID; Docker Desktop and WSL are stopped. Shared volumes retained.

## Remaining gates

Production composes no temporary producer/reader. Original actor/native memory session host
and transport with bounded content leases, typed temporary resume lifecycle/reader, native candidate edit authority, active
server/client idle/logout/cancel/confirmed-submit disposal, ATS content handoff, and D3-012
provider retention approval remain mandatory. A process timer or response guard is not proof of
all-copy purge, physical frozen-Lambda expiry, remote settlement or socket/client delivery.
SQL state is a point-in-time check, not atomic cross-owner cancellation/HTTP delivery.
No browser UI was changed or exercised; installed client/deployed acceptance remains separate.
No phase exit or removed development-panel manual step is reopened or marked complete.

The synchronous `isCurrent` callback checks live memory availability; it is not a held borrowed
content lease, an atomic remote cancellation fence or a native transport-disposal receipt.
Bounded outgoing-copy authority and all-copy native/client disposal remain activation gates.
