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
Full clean-source verification passes as recorded below. Managed capture/maintenance release,
independent audit security/rights review, managed alert/incident metadata retention verification
and phase acceptance remain open. No cloud deployment/activation, main merge, new PR or hosted CI/CD work is asserted.
The PC stays on.

The exact owned tmpfs SQL fixture is removed after label verification, with shared volumes
retained. Docker/WSL are stopped. The owning isolated web parent/child are stopped before full
verification so session checks can reserve localhost:3000.

## Full verification and restored development web

Frozen clean source `18632bdcce2bc6417088e35941b63fbaa0642a18` passes
`scripts/verify-phase0.ps1` with explicit matching ARTIFACT_SOURCE_SHA. The original run completes
with exit zero: 38 typecheck tasks, 39 test tasks, 23 production builds, maintained operator/security
checks, all emitted bundle isolation checks and Compose configuration. Lint remains zero errors,
15 warnings and 58 infos. Log: `.tmp/d1-privileged-audit-full.log`. Conditional SQL tests in the
workspace run remain skipped; the six real PostgreSQL cases above are separate explicit evidence.
No tracked edits occur while that full run is alive.

The maintained development launcher restores the isolated web against the live development API.
Unauthenticated local root returns 200 and `/resume` returns 307 with redirects disabled. These
startup checks do not repeat or extend the owner's accepted Profile/save/reload browser checks.
Only the two generated Next development type imports are restored to committed source after
inspection. No frontend feature changes occur. Docker/WSL remain stopped and the PC remains on.

## Alert-retention source inspection

The accepted D1P-06 policy distinguishes 30-day delivery metadata from the retained aggregate
acceptance record. `scripts/operate-platform-alerts.ps1` emits aggregate status/exercise proof,
including reviewed recipient-set digest and explicit manual confirmation; it does not write a
raw recipient or delivery-history artifact. Recipient subscriptions are current configuration,
not an application incident-history table. No new deletion implementation is inferred from them.

The application CloudWatch log group in
`infrastructure/terraform/modules/platform/main.tf` configures 30-day retention. The
[current CloudWatch alarm guide](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Alarms.html)
documents 30-day alarm-history retention. These are source/service policy evidence, not fresh
managed-state or all-copy expiry acceptance. A read-only development STS attempt cannot obtain
credentials because the SSO token has expired and refresh failed; no cloud state changes or new
managed verification is claimed. Actual storage/producer coverage and managed retention evidence
remain required before closing D1-012. No unnecessary application alert table or cleanup service
is added to substitute for that evidence.
