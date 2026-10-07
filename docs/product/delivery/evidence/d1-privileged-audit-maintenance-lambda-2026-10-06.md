# D1 private privileged audit maintenance Lambda — 2026-10-06

Status: default-off source and local evidence; D1/D3 remain In progress.

D1-012 now has a separate executable maintenance entrypoint for the accepted 365-day privileged
access/action audit expiry. It reuses the Profile-owned exact-format bounded transaction added
in [audit evidence](d1-privileged-moderation-audit-2026-10-06.md). No schema, migration, public
contract, Gateway capture semantics, candidate export or case-history lifetime changes occur.

`privileged-moderation-audit-retention-lambda.handler` accepts only the closed data-only
`{schemaVersion:1, action:"expire"}` envelope. It refuses extra fields/accessors before secret or
SQL access. Its invocation context must equal the numeric own function version in the configured
us-east-2 account. These identity checks are configuration guards, not caller authentication;
reviewed private invocation IAM remains required. No public route or invocation grant is created.

Retention defaults off. Literal enablement, bounded canonical batch (default 100, maximum 1000),
qualified same-account managed database-secret ARN, runtime session context and exact function
identity are required. DATABASE_URL overrides are refused. Configuration is pinned after first
valid admission; warm secret/target/batch drift refuses without repinning, while session token
rotation is allowed. Existing bounded local Secrets extension lookup supplies the owner URL.
Flag/configuration withdrawal during lookup cannot create a SQL runtime.

Each invocation owns one native Profile PostgreSQL pool with a 10-second statement timeout and
an expiry-only facade. The existing transaction rechecks admission after actual SQL and rolls
back if withdrawn. No locks cross secret lookup; a pool is closed after success or failure.
Concurrent invocation refuses without releasing the original guard. Fixed errors suppress raw
SQL/secret details. Response contains only schemaVersion, fixed owner and bounded expired count,
never operator fingerprints or row identifiers. Withdrawal after commit or while closing withholds
the response; it cannot undo a transaction already committed. A retry safely selects remaining due
rows, not an invented replay count or all-copy deletion assertion.

The builder emits a separate ZIP and provenance/SBOM/checksum companions below
`backend/services/profile/dist/audit-retention-lambda`, using the existing source-bound artifact
builder. `pnpm --filter @ai-job-apply/profile-service build:lambda:audit-retention` runs an actual
emitted cold default-off refusal without network. The full verifier now includes the emitted
maintenance dependency isolation check. No publisher, Terraform resource, scheduler, role/grant,
cloud deployment, activation, main merge, new PR or hosted CI/CD work is added.

Local evidence:

- Profile build passes after correcting an optional-session-token typing error.
- Nineteen focused cases pass: managed composition, invalid configuration before effects, strict
  input/recipient, warm drift/credential rotation, lookup withdrawal, fixed SQL errors, invalid
  counts, expiry/close withdrawal and overlapping calls. Owner/secret ports are simulated here.
- Seven real PostgreSQL cases pass with actual Profile migrations replayed twice in a newly owned
  PostgreSQL 16.6 loopback tmpfs fixture. The added case uses actual Lambda factory, actual runtime
  and expiry transaction: bounded two then one then zero, with a withdrawn in-transaction operation
  retaining the remaining record. Managed identity/secret lookup are synthetic; SQL and connection
  cleanup are real. Existing capture/age/foreign/export/concurrency cases remain passing.
- Actual emitted isolation passes: only the three Profile owner modules plus postgres/uuid enter;
  no AWS SDK/model/renderer/object/Gateway/application consumer is bundled.
- Initial local artifact builds: 22,742 bytes, two SBOM components, cold default-off refusal passes.
  This initial build uses local provenance; exact committed-source builds/full verification remain.
- Unsafe throwing from a finally block is corrected before final verification; cleanup failure and
  primary failure are reduced to the fixed error after cleanup rather than overriding control flow.

Logs: `.tmp/d1-audit-maintenance-{build,tests,sql,bundle,artifact-local}.log`.
Owned SQL fixture is removed after exact label validation; shared volumes remain. Docker/WSL are
stopped. Development web will pause only while the full verifier reserves localhost:3000, then
be restored. The PC remains on. Managed secret extension/runtime/IAM/scheduling/release, alert
retention verification and independent security/rights/phase acceptance remain open.
