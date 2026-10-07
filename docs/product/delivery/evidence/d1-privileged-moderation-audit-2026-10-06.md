# D1 privileged moderation audit capture and expiry — 2026-10-06

Status: default-off source and local SQL/HTTP evidence; D1-012 and D1/D3 remain In progress.

Accepted D1P-06 selects 365 days for privileged access/action audit, separately from 365 days
after closure for case/decision history. Existing moderation routes previously had no separate
access audit. The default-off Gateway now records fixed access/attempt metadata after jobs:moderate
authentication and strict request validation, before any moderation read or write. Open/resolve
records say attempt; they never assert business success or notification receipt. Audit failure
withholds the operation. Existing scope, request/response, operator-redacted projections and
case-history retention remain unchanged. No new public route is added.

Profile owns the existing platform.audit_events relation and a separate native one-connection
Date/JSON pool. Only four fixed Jobs moderation actions, a bounded existing OIDC operator
fingerprint and nullable resource UUID enter the writer. Database time stamps the record; the
owner creates a UUIDv7 record/trace ID. user_id is NULL so unrelated operator metadata cannot
enter candidate exports. Raw subjects/emails, credentials, request bodies, reasons and cursor
values are absent. The fingerprint is pseudonymous metadata, not anonymous aggregate evidence.
The private writer facade exposes no read/update/expiry capability. This uses existing generic
audit columns/JSON metadata; no table, migration, shared schema, event or public contract changes.
It does not retrofit or invent historical access records, change older audit formats, or claim
new database tamper-proof append-only enforcement.

PRIVILEGED_MODERATION_AUDIT_ENABLED defaults off. Withdrawal in a warm composed writer refuses
moderation requests instead of silently bypassing audit. Separate Profile maintenance requires
PRIVILEGED_MODERATION_AUDIT_RETENTION_ENABLED=true and a canonical 1..1000 batch (default 100).
`pnpm --filter @ai-job-apply/profile-service audit:expire` operates only the exact owned format,
NULL candidate link, fixed resource type, generated trace identity and 365-day database age.
Recent, other-action and malformed/unowned formats remain. Ordered SKIP LOCKED batches and
counts-only output avoid row disclosure. Flag withdrawal rolls the transaction back after actual
SQL settlement. No scheduler, managed maintenance invocation or new runtime grant is activated.
Existing backups and candidate-rights policies are unchanged; managed restore acceptance remains.

Local verification:

- Profile build and Gateway typecheck pass.
- Six validation cases reject raw identities, unexpected body/token/action fields, invalid IDs,
  accessors and default-off input before SQL.
- Six actual PostgreSQL cases pass capture, exact 365-day selection, retained recent/other/malformed
  records, candidate-export exclusion, bounded concurrent expiry and transactional rollback on
  capture/expiry withdrawal. Actual Profile migrations apply twice in a newly owned PostgreSQL
  16.6 loopback tmpfs fixture. No provider, cloud or production identity is used.
- 216 signed synthetic Gateway cases pass, three existing conditional cases skipped. All four
  moderation routes record fixed metadata; unauthorized/invalid requests cannot audit, audit
  errors become fixed 503, and a failed audit prevents the case write. Authentication uses the
  actual test JWT verifier, while Profile/audit/moderation HTTP owner ports are simulated. SQL
  storage/expiry is exercised separately above; no connected managed OIDC/SQL deployment claim.
- Actual compiled maintenance entrypoint refuses while default off before connecting to SQL.

The first SQL run catches a real native-driver JSON inference bug: a pre-serialized string
becomes JSON string metadata, so exact object expiry cannot match it. The writer now builds the
fixed object in SQL with scalar bound operator data. The actual metadata and expiry checks pass
without relaxing any predicate. No migrated or production malformed rows are claimed or changed.

Logs: `.tmp/d1-privileged-audit-{sql-acceptance,units,gateway-final,cold-refusal}.log`.
Full clean-source verification remains. Managed capture/maintenance release, independent audit
security/rights review, 30-day alert/incident delivery metadata enforcement and phase acceptance
remain open. No cloud deployment/activation, main merge, new PR or hosted CI/CD work is asserted.
The PC stays on.

The exact owned tmpfs SQL fixture is removed after label verification, with shared volumes
retained. Docker/WSL are stopped. The owning isolated web parent/child are stopped before full
verification so session checks can reserve localhost:3000.
