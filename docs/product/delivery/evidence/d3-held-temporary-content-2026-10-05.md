# D3-064 held temporary content and terminal scope disposal — 2026-10-05

Status: In progress; backend source/local evidence, default-off and undeployed.

Started on freshly fetched main `e48bdf3a` and fast-forward integrated exact open #552
`0e0e0f33`. [ADR-038](../../../adr/038-one-off-generated-application-materials.md) remains
binding. D1/D3 remain In progress. Hosted CI/CD is deferred until production launch by the owner.

## Implemented path

Authenticated cover-letter HTTP read → Applications packet/deadline checks → held Documents
memory lease/render → revalidation on that same held copy → final owner SQL snapshot → guarded
serialization/send → finish/error/closed-connection release. Response content is never durable.

- Memory leases retain managed byte-copy accounting and reserve outgoing capacity before rendering.
  Cover-letter responses reserve 512 KiB within the existing 16 MiB/16-borrow upper bounds.
  Owner context revalidation uses the held lease, so a configured one-borrow host can serve safely.
  Invalid/detached copies are rejected with fixed errors; release is idempotent.
- Request abort cancels controlled bytes/signals. An unsettled renderer callback retains its
  reservation until its actual return; abort/timer is not settlement. Ready held responses clear
  paragraph/file content on original expiry, explicit release, request abort or owner disposal.
  No read/approval/download/retry renews generation completion or its original deadline.
- HTTP releases after response completion or failure/connection closure. Abort signals are scoped
  per request and socket listeners are removed; callbacks/signals are not serialized into output.
- Cancellation/positive confirmed submission/positive submitted reconciliation invoke the memory
  owner's scope disposal after SQL commits, including on idempotent replay. Scope is sealed against
  late publication of a new generation in this process. Terminal scope-fence capacity is bounded;
  exhaustion closes memory safely. Ambiguous outcomes do not grant disposal or new dispatch.
- Missing/failed disposal acknowledgement returns a fixed availability error while preserving the
  committed cancellation/confirmed evidence and duplicate guards. Same-key replay retries disposal,
  not generation/submission. `discarded` acknowledges controlled local copies/fence only; it is not
  a remote writer/provider/native-host physical-purge receipt.

No public schema/route/query, migration, durable body, new infrastructure, frontend or activation
change. Private process-local owner read capabilities now require held-copy revalidation/release
and abort signal; metadata-only approval ports remain supported. Deploy compatible owner adapters
before activation. Repeated API generation remains byte-identical:
`3391959363ab7f0d2ad0f6a77462e480f7778670eb5be6bc0d670d9ec06bd4bd`.
Restore inventory remains 63 migrations, seven owners and 84 relations; no recovery contract change.

## Executed focused evidence

- Applications 211 units pass; nine added lifecycle/release/disposal cases.
- Documents two focused files: 71 pass, including 13 new held-copy/reservation/idle-expiry/terminal
  fence/abort/revalidation cases. Full verification passes all 1,283 Documents units.
- Gateway two focused files: 101 pass, three opt-in skips; two new successful-send/serialization-
  failure release checks. Existing caller assertions now include the internal abort signal.
- Real PostgreSQL Applications: 91 pass, one unrelated opt-in skip, eight files.
- Real PostgreSQL Gateway: 51 pass across three files. Four new connected cases cover positive
  cancellation/confirmed cleanup, disposal outage followed by exact idempotent replay, and an
  actually opened loopback HTTP connection destroyed during a held download. All connected content
  cases run with one borrow, real bounded memory, native original completion and production PDF/DOCX
  rendering. Model output, evidence-source fixture and OIDC are simulated; no live model/ATS call.
- Terminal SQL state/packet expiry/confirmation metadata persist after cleanup, with one confirmed
  attempt and refused redispatch. Managed output is cleared on disconnect and pool capacity is
  recovered. Known revoked lease is checked before cleared-body validation; it returns stale 409,
  not a misleading malformed-body availability error.
- Clean `56335f55c36843f080c25cb0112eddbc11b2c4a3` passes the full maintained verifier:
  38 typecheck tasks, 39 workspace test tasks and 23 builds, plus operational/security/Compose
  and emitted dependency/isolation checks. Lint remains zero errors, 15 warnings, 58 infos.
  Gateway default suite: 307 pass, 61 opt-in skips; skips are not counted as SQL/remote evidence.
  Local receipt `.tmp/d3-held-content-verify.log`, terminal exit `0`.
- Relevant builds/typechecks, repeat generation and changed-file formatting pass.
- Focused checks initially caught detached-buffer release, internal signal assertion and revoked-
  lease classification regressions; each was corrected and rerun. Real loopback connection setup
  uses the actual listener URL. Earlier failed focused runs are not passing evidence.
- Owned tmpfs fixture `03c10a851017c2fc5f8310c7559d477e391bd7a6f466ad67d66e291b984babe5`
  was inspected and removed by exact ID. Shared volumes retained; Docker Desktop and WSL are
  stopped, with no running WSL distribution. All verification sessions are terminal.

## Limits and remaining gates

These leases bound controlled process-local copies and outgoing reservations. They cannot erase
immutable/transferred/externally held bytes, certify socket/client delivery, make a SQL read atomic
with network delivery, stop an unknown renderer/provider writer or prove physical expiry in a frozen
Lambda. Native original actor/session hosting and authenticated transport, cross-process held-content
leases/disposal receipts/worker drain, typed temporary resume lifecycle, native edit authority,
client idle/logout/cancel/confirmed-submit cleanup and ATS handoff remain. D3-012 provider retention
approval is mandatory before activation. None of this closes deployed/browser/accountable acceptance.
The private disposal port must not be interpreted as a new remote settlement certificate.
No UI changed or browser journey exercised; frontend work remains in the other worktree.
