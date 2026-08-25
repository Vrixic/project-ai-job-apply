# Candidate deletion recovery replay

Use this gate only against a private, quiesced PostgreSQL restore before any application role or
route can reach it. The recovery ledger is outside RDS, versioned, KMS-encrypted, and retained with
S3 Compliance Object Lock through the configured backup window. Its locator is also encrypted with
an exact KMS encryption context.

The operator must use the exact release candidate and the accountable policy values that created
the retained markers. Never point this command at the primary database. Supply the restore URL only
in process memory from the approved secret path; do not write it to a receipt or repository file.

```powershell
$env:RESTORE_DATABASE_URL = '<private restored database URL>'
$env:CANDIDATE_DELETION_RECOVERY_BUCKET = '<candidate_deletion_recovery_bucket output>'
$env:CANDIDATE_DOCUMENT_BUCKET = '<candidate_document_bucket output>'
$env:CANDIDATE_DATA_EXPORT_KMS_KEY_ARN = '<platform KMS key ARN>'
$env:CANDIDATE_RIGHTS_POLICY_VERSION = '<approved version>'
$env:CANDIDATE_RIGHTS_POLICY_SHA256 = '<approved lowercase SHA-256>'
$env:CANDIDATE_RIGHTS_EXPORT_LIFETIME_SECONDS = '<approved seconds>'
$env:CANDIDATE_RIGHTS_DOWNLOAD_GRANT_SECONDS = '<approved seconds>'
$env:CANDIDATE_RIGHTS_BACKUP_RETENTION_DAYS = '<approved days>'
$env:CANDIDATE_RIGHTS_RECENT_AUTH_MAX_AGE_SECONDS = '<approved seconds>'
$env:CANDIDATE_RIGHTS_OWNER_INVENTORY = 'identity,profile,documents,jobs,matching,billing'
$env:CANDIDATE_RIGHTS_SUBPROCESSOR_INVENTORY = 'none'
$env:CANDIDATE_DELETION_RECOVERY_REPLAY_ACK = `
  'RESTORED_DATABASE_IS_QUIESCED_AND_NOT_SERVING_TRAFFIC'

pnpm --filter @ai-job-apply/workflows replay:candidate-deletions
```

The command emits aggregate counts only. It refuses an incomplete recovery marker, policy mismatch,
invalid encrypted locator, primary/restore URL equality, non-empty exact document-object inventory
after cleanup, or any owner deletion failure. Keep the restore isolated and investigate on any
failure. A successful aggregate is necessary but not sufficient for recovery: complete the normal
schema, integrity, workflow, alarm, and accountable restore acceptance before serving traffic.

Clear all process-scoped values after the run. The operator must separately attest that the RDS
earliest restorable point and the complete manual/cross-account backup inventory are later than a
deletion confirmation before declaring its backup window expired; elapsed time alone is not proof.
