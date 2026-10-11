# D3-104: Reconcile completed deletions on a restored development primary

Started: 2026-10-10. Status: Implemented and locally verified; managed execution pending.

An explicit default-off `primary_recovery` mode reuses the existing private deletion replay on the
canonical development database with all writers off. Mode absence retains isolated PITR behavior.
Primary source/target identifiers, endpoints, physical IDs and boundary metadata must match; the
operator rereads the available private encrypted protected source and its exact-physical safety
backup. It reuses current full-input zero-action planning, encrypted backend checks and writer drain.
No physical restore rehearsal, whole-row attestation or special promotion-proof operator is required.

Before Inspect/Replay, the primary path checks current schema and migration checksums in read-only
SQL with timeouts and actual pending-query cancellation. A real PostgreSQL failure revealed the
profile client's camelCase columns; the adapter now restores SQL column names without changing
values. Serializable deletion preflight, retained marker/document checks, owner deletion functions,
all eight owner terminal postconditions, numeric invocation, single-attempt operator journal and
original 30-minute admission remain. Cleanup removes only the owned temporary Lambda. Remove it
before changing its bound database, backup, role or network. Ambiguous results keep traffic off;
inspect explicitly and never replay automatically.

Executed: 466 focused tests across five workflow suites; 790 existing replay assertions; 26 primary
mode/backup/target assertions; workflow typecheck and component build; packaged default-off refusal;
17 real PostgreSQL cases, including current schema and unrelated durable-data preservation. All pass.
The simulated connected Chromium journey passes search/preparation/review/approval/manual Apply/
candidate confirmation/history, downloads, withdrawal and expiry checks. Authentication, BFF, native
service and receiver are simulated; live generation/installed extension/external submission remain.
No full repository checks ran. Consequential reviewer passed source, schema adapter and saved plan.

A read-only 143-input exact-final-snapshot restore plan is prepared and reviewed. It creates only
the protected database, updates reader IAM/function/alias bindings and refreshes the same connection
secret version; sole output change is lifecycle mode. It has not been applied. The local artifact is
unpublished, with no release provenance claim. Managed restore, completed-deletion replay, compatible
D3 release and live connected acceptance remain. Independent D1/admin acceptance stays deferred.
Development AWS was not activated; Docker/WSL are off after tests and the PC remains on. Retained
storage still incurs costs. Private evidence: `.tmp/d3-primary-recovery-*` logs and
`.tmp/d3-primary-recovery-20261010/` plan/review/smoke artifacts.