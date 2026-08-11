# D1 Development Job Catalog Migration — 2026-08-11

## Outcome

The synthetic-only D1 canonical-job schema is deployed in the isolated development environment.
The release used merged source commit `3e98f8ee01646cd04fd7dfec02c98da40cf3d979` and the immutable
runtime manifest digest
`sha256:238fe29de4d7b4cb55a66729af4a2252d3e24e4723e85d2c71cbb88e3cb6dd8f`.
The ECR scan completed with zero Critical and zero High findings.

This evidence does not authorize real provider ingestion, public UGC, real candidate data, or
production activation. The repository and deployed foundation remain restricted to approved
synthetic fixtures under ADR-011.

## Reviewed infrastructure release

Terraform plan SHA-256
`271897dd16ce2e5d4443faa3e5877405232c90c878b337ab2d6301363a9652f6` applied to development in
`us-east-2`. It:

- replaced the dormant one-off migration task definition with the composed `profile -> jobs`
  migration runner;
- retained Fargate, `awsvpc`, Linux/X86_64, 256 CPU units, 512 MiB memory, a read-only root
  filesystem, no application task role, and only the `DATABASE_URL` secret;
- moved four accepted data-plane state addresses without resource replacement;
- changed `delete_automated_backups` from true to false so automated backups are retained after a
  future database deletion; and
- preserved database encryption, deletion protection, seven-day backups, and point-in-time
  recovery.

No task ran and no schema changed during the Terraform apply.

## Migration execution

Execution plan SHA-256
`7e244e96f44bfa9fae8b1a05018dc5d2f8aeab83a5dafaff3182e2423d2b2ede` authorized exactly one
on-demand Fargate task with the task definition's default command and no effective container,
environment, role, CPU, memory, or resource override. AWS returned a name-only container wrapper;
inspection confirmed that it carried no override value.

The task:

- reached `STOPPED` after 26 runtime seconds with exit code `0`;
- ran the exact reviewed runtime digest;
- replayed and checksum-verified profile migrations through
  `0003_retire_legacy_dispatch`;
- transactionally applied and verified jobs migration `0001_job_catalog` under the jobs-owned
  advisory lock;
- emitted exactly one profile success event, one jobs success event, and one aggregate success
  event;
- emitted zero error-like or restricted-data log events; and
- returned the migration cluster to zero running tasks without a retry.

The jobs runner verified its migration record, all six expected jobs-owned tables, and the three
exact-identity indexes before reporting success. A failed or checksum-mismatched transaction would
have stopped the aggregate runner and rolled back the jobs transaction.

## Post-migration acceptance

- A full refresh-backed Terraform plan returned exit code `0` with zero drift. Its saved plan
  SHA-256 is `47e239131ce88fe737189aef77872e73c6a2048cc6c8fd021059c424a414ac18`.
- API liveness returned `200`.
- API readiness, including the database dependency, returned `200`.
- An unauthenticated protected request returned `401`.
- All 16 development metric alarms were in a determinate non-`ALARM` state; none reported
  `INSUFFICIENT_DATA`.
- The development database remained available, encrypted, deletion protected, covered by
  seven-day backups, and point-in-time restorable.

This release proves the deployed schema and migration boundary. It does not yet prove the D1 job
API/read model, moderation resolution, authenticated catalog behavior, real-source ingestion, or
complete D1 product acceptance; D1-004 therefore remains in progress.
