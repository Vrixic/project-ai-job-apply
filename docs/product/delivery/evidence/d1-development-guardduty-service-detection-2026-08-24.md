# D1 development GuardDuty service-detection acceptance — 2026-08-24

## Outcome

The development document quarantine boundary accepted one generated clean PDF through the existing
AWS GuardDuty Malware Protection for S3 plan. GuardDuty, rather than the acceptance operator, wrote
the exact object-version tag `GuardDutyMalwareScanStatus=NO_THREATS_FOUND`. The operator then removed
the owned object version and generated database identity. Document processing remained dark.

This closes the narrow D1-002 service-detection proof. It does not authorize or prove EventBridge
delivery, SQS delivery, the event-source mapping, reconciler, processor/parser execution, API Gateway
or managed-OIDC behavior, a real resume, or a document-processing trigger.

## Bound execution

- Deployed application source: `eb617045e98a0a5db70f0b6250e27d0d6102622b`.
- Acceptance operator source: `5121a3f1f640d3844dc464db660da1ed7b65f8eb`.
- Terraform state serial before and after the run: `190`.
- Execution-plan SHA-256:
  `73119483eade7bdc560d8531945d7cebccc9b952d76feb6b90bac017ce3335a0`.
- Generated clean-PDF fixture SHA-256:
  `8f89a1770f0d68a6d995a95731d553c100ae95e2e775bf8a7ec9936867278f58`.
- Local ignored receipt SHA-256:
  `029879f1057a86dff62a19ad7f11a14702862f8eeb333a7efbb78e83ad9b6ac3`.
- Protection plan status: `ACTIVE`.
- Protected bucket scope: the exact candidate-document quarantine bucket and only its `quarantine/`
  prefix.
- Protection-plan tagging status: `ENABLED`.
- Service scan result: `NO_THREATS_FOUND`.
- Scanned object count: `1`.
- Persistent generated rows after cleanup: `0`.
- Database cleanup: `true`.
- Exact object-version cleanup: `true`.
- Trigger activation: `false`.
- Real candidate data: `false`.

The ignored receipt, execution descriptor, generated identity, bucket/object identity, AWS account
identity, and recovery descriptor remain local and are not copied into this shared evidence.

## Dark-state and operational checks

Post-run verification found the GuardDuty result rule, document scan event-source mapping, and
reconciler rule disabled. ECS had zero running and zero pending tasks. All eight document alarms were
`OK`. The exact result, scan DLQ, and delivery DLQ queues each existed and reported zero visible,
in-flight, and delayed messages. Docker had zero running processes and WSL had zero running
distributions.

## Verification

The operator's focused regression suite passed under PowerShell 7 and Windows PowerShell 5.1. The
script parsed successfully and `git diff --check` passed. Repository-wide formatting and linting
remain red only on pre-existing, unrelated ignored files under `skills/frontend-design`; those files
were not changed as part of this acceptance.

## Remaining boundary

The next document-processing decisions remain the managed-OIDC/API Gateway/JWT/JWKS acceptance,
ADR-023 human disposition, mapping/reconciler-first activation evidence, the AWS-managed DNS risk
decision, deletion/export and recovery reconciliation, adversarial document review, and accountable
security/privacy/product acceptance. Until those decisions are recorded, all document processing
triggers and real resumes remain disabled.
