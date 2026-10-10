# D3 privacy replay inventory — 2026-10-10

The restore-only deletion store omitted six newer Applications tables from its owner counts.
Valid archive/preparation rows already require counted parents, but native material withdrawals
are an independent root referencing Identity. A restored completed deletion with only withdrawal
data remaining could therefore be classified as already reconciled and skipped.

The existing aggregate query now counts all fifteen Applications-owned tables. Preflight,
already-completed detection and post-deletion verification share this query; deletion continues
through the existing authorized owner function. No schema, migrations, public contract, runtime
permissions, submission behavior or generated-material expiry changes.

Eight real PostgreSQL cases pass, including two new completed-deletion regressions: withdrawal
alone and withdrawal with its terminal cleanup queue. Both require actual deletion, preserve
another owner and verify a subsequent idempotent skip. Paired synthetic encrypted archives also
exercise deletion and owner isolation in the existing policy/export cases; no live crypto is
claimed. All 234 focused store/contract unit tests and workflow typechecking pass.

The initial archive fixture lacked its required timestamp; it was corrected. The next run exposed
host/Docker clock skew against Trust's strict future-date guard. Generated recovery persistence
events now use PostgreSQL's clock; the production guard remains unchanged. The maintained
dump/restore harness passes: 79 migrations, twelve schemas and all 96 exact relation row sets,
including 21 inventory probes and seven reconciliation probes with simulated KMS. Every generated
test container is removed, and Docker/WSL are off. All 43 repository verification stages pass.
The first full run stopped on a readiness-entrypoint timeout and a subsequent mock assertion;
all 44 affected tests and the complete verifier pass on rerun without source changes. The
successful full run includes 1,910 workflow tests; 125 integration cases are skipped there,
separate from the eight PostgreSQL cases explicitly executed above.

PostgreSQL log SHA-256: `475a3c804472be3316c384a0c8644960faae92b8cdd94437a3d7814ef53ea7ce`.
Maintained recovery log: `67324d82813766f8bd54269834ca5de5884408b4896b16e4ab4b37f4aa51e637`.
Full verifier recheck: `9ff75a59871c1dfb08e4e41fa22a7fad7be27483ba249eb0079aeff75a96985f`.
Development shutdown readback at `2026-10-10T19:21:52Z` confirms test runtimes off. Retained
storage/security resources incur charges; staging was not accessed and the PC remains on.

Managed privacy replay, corrective primary recovery, compatible release and the live native
journey remain unfinished. The earlier [managed reconciliation](d3-native-application-disposal-2026-10-07.md#managed-transition-reconciliation-and-cleanup--2026-10-10)
proves seven original receipt digests through KMS, not privacy acceptance. Independent D1/admin
acceptance remains deferred.
