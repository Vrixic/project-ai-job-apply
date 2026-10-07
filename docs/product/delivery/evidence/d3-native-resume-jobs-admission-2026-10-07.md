# D3 native resume Jobs admission â€” 2026-10-07

D3-064/D3-079 source and local verification only. D1/D3 remain In progress;
ADR-040 remains Proposed. Nothing is deployed or activated.

Jobs now owns a default-off private same-transaction admission adapter. It checks
exact canonical identity, active/unexpired posting, current exact-member source
evidence, Gateway's existing canonical `job-revision.v1` digest and Documents'
full title/description resume digest. It never substitutes cover-letter model
context or provider consent for deterministic resume authority.

The existing catalog revision statement triggers fence committed posting, company
and alias changes. A shared revision-row lock lasts until the caller's transaction
ends. Sources lack this trigger, so all current exact-member source rows are
separately locked, including withdrawn rows. Concurrent additions only add source
evidence; held evidence cannot be withdrawn, deleted or reassigned before commit.
This briefly delays catalog writes. Use only short bounded control transactions,
never source/object/network reads, rendering or provider calls while held. Locks
cannot stop wall-clock expiry; later operations must repeat admission. Unknown
SQL/shape/flag failures produce one fixed error without posting diagnostics.

`createNativeResumeGenerationOwnerPorts` composes actual Applications preparation
and Jobs proof on Documents' supplied transaction, retaining owner boundaries.
A narrow Applications package subpath avoids loading its database/bootstrap barrel.
These ports do not issue generation authority, dispatch tasks or read source bytes.
The ledger integration now exercises this real composition; its former synthetic
Jobs authority has been removed.

## Local verification

- Jobs, Workflows and Documents production compilation pass.
- Two focused admission cases pass: default-off/closed accessor refusal and fixed
  diagnostic/withdrawal refusal.
- All 22 PostgreSQL 16.6 ledger cases pass. Profile, Applications, Jobs and Documents
  migrations replay twice against an owned synthetic tmpfs cluster. Seven added
  cases cover existing packet hash compatibility, description drift, company/title/
  location changes, withdrawal/expiry/terminal state, actual held-lock lifetime,
  canonical alias source aggregation and changed-job refusal after original readiness.
  Concurrent posting, company, alias-statement and source writes hit their real
  lock timeout until the caller ends its transaction. Original completion/expiry
  remain unchanged after refusal.
- Both emitted preparation bundle checks pass. The resume owner composition excludes
  SQL clients, AI/model, AWS, catalog runtime and content/rendering modules, and its
  actual bundled default-off ports refuse before SQL.
- Original full maintained verifier completed with exit 0 at clean, frozen source
  `3ff948484667f6a2b89e26b4367998717e1b1245`, with matching explicit
  `ARTIFACT_SOURCE_SHA`: 38 typecheck tasks, 39 test tasks, 23 builds, formatting,
  security/operator/artifact isolation, Compose and product-scope guards pass.
  Its original process handle was 53868; tracked source stayed unchanged throughout.
  The run had zero lint errors, 16 warnings and 58 informational findings: one new
  warning was an unused type-only import in the SQL test. After terminal completion,
  that import was removed. Full lint returns to the existing 15-warning/58-info
  baseline; Documents production compilation passes and the emitted integration
  test JavaScript SHA256 is exactly unchanged. The full verifier was not repeated
  for this erased type-only cleanup or the evidence update. No runtime implementation
  changed after the frozen-source pass.

No schema, migration, public API, event, frontend or infrastructure change. The
restore inventory remains 71 migrations / 93 relations / 12 schemas / 7 owners,
with the existing manifest digest and previous logical restore evidence retained.
AWS/task/retirement ports remain synthetic; no new actual Linux/kernel rendering
run, cloud publication, managed task/routing or live end-to-end proof is claimed.

Authenticated resume RPC/source/task bootstrap, preparation/packet read composition,
image/client/ATS and managed/accountable acceptance remain. Hosted CI/CD stays
owner-deferred. No new PR, main merge or deployment. Owned SQL fixture removed;
shared volumes retained, Docker/WSL stopped and PC remains on.
