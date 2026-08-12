# D1 Development Resume Processing Migration — 2026-08-12

## Outcome

The development database is deployed and verified through Profile
`0005_resume_fact_proposals`, Jobs `0003_duplicate_resolution_audit_guard`, and Documents
`0002_resume_processing`. This completes the database prerequisite for the D1-002 document
processor dark deployment. It does not enable a processor, queue trigger, GuardDuty result rule,
real resume processing, or production data.

## Reviewed execution

- The bootstrap workload boundary was applied separately and verified before this migration.
- The immutable Linux/AMD64 migration image passed a complete scan with zero High or Critical
  findings.
- The checksum-reviewed Terraform task-definition plan replaced only the retained one-off
  migration task definition with the exact immutable image digest.
- A checksum-reviewed schema-v2 execution descriptor requested exactly one Fargate task with the
  Terraform-owned cluster, two subnets, and application security group, and contained no ECS
  override.
- Before submission, the operator created a conditional, versioned, customer-KMS-encrypted,
  checksum-verified durable execution claim. The claim permanently prevents descriptor replay.

## Acceptance evidence

- Exactly one migration task was submitted and stopped with exit code `0`.
- The task used the exact reviewed task-definition revision and immutable image digest.
- CloudWatch contained exactly four aggregate-only success records: Profile through `0005`, Jobs
  through `0003`, Documents through `0002`, and the aggregate completion record.
- No candidate value, resume content, secret, database URL, or user identifier was recorded in the
  retained evidence.
- The cluster returned to zero active migration tasks and contains zero continuous ECS services.
- The encrypted, versioned state object remained protected by the environment customer KMS key.
- A refresh-backed Terraform verification plan contained zero proposed resource changes. Its only
  refresh records were the forward-moving RDS PITR timestamp and the provider's exact
  `null`-to-empty migration-task tag normalization; both passed narrow full-object equivalence
  guards.

The local waiter ended after the task completed but before finalizing its receipt. The recovery-only
operator validated the immutable claim, submitted receipt, stopped task, exact log stream, four-log
contract, and zero-compute boundary without calling `ecs run-task`, then finalized the original
receipt. The final independent `Verify` action passed.

## Remaining gate

The coordinator and parser Lambda artifacts must be published from the final merged source and the
processing infrastructure must be deployed dark with the SQS mapping, reconciler, and GuardDuty
result rule disabled. Direct synthetic IAM and parser/coordinator conformance must pass before any
trigger activation. Real candidate resumes remain prohibited behind the deletion/export, DNS,
adversarial-parser, and accountable review gates.

## References

- [Resume processing foundation](d1-resume-processing-foundation-2026-08-12.md)
- [D1 task register](../phase-1-web-and-job-catalog.md)
- [Database migration runbook](../../../../infrastructure/runbooks/deployments/database-migration.md)
- [ADR-023](../../../adr/023-isolate-untrusted-document-parsing.md)
