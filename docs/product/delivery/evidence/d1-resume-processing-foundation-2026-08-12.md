# D1 Resume Processing Foundation — 2026-08-12

## Outcome

D1-002 now has a locally implemented scan-result-to-proposal release candidate. It extends
the already accepted development quarantine upload without granting the untrusted parser database
access or general internet egress. No processing resource or migration from this change is claimed
as deployed, and real candidate resumes remain prohibited.

## Implemented boundary

- strict identifier-only `document.scan-result.v1` event with exact AWS account, region,
  GuardDuty protection-plan ARN, bucket, quarantine key, object version, disposition, and time;
- encrypted EventBridge/SQS/DLQ transport, disabled by default, with at-least-once receipts and
  canonical per-object dispositions;
- separate scale-to-zero coordinator and parser Lambdas: the coordinator owns state/imports but
  never parses bytes; the parser has no database secret, application logs, traces, direct object
  role permissions, or routed internet path;
- 15-minute STS sessions narrowed to one exact source version, one deterministic output key, and
  KMS-via-S3 operations, issued through a private endpoint;
- independent exact-version S3 tag, metadata, KMS, size, SHA-256, type, and magic verification;
- bounded deterministic PDF/DOCX parsing with active-content, traversal, encryption, archive,
  page, character, block, and expansion rejection;
- deterministic KMS-normalized JSON storage with collision verification and no extracted text in
  PostgreSQL, events, logs, traces, or Lambda results;
- transactional Profile-owned import receipts, proposed facts, and immutable block/offset evidence;
- explicit confirm, edit-and-confirm, and reject actions with expected-version/idempotency control;
- bounded web polling that terminates on success/failure and a separate accessible proposal-review
  surface; and
- queue, DLQ, Lambda, record-failure, GuardDuty-plan/tag, and security-contradiction alarms plus a
  bounded stuck-state reconciler and staging lifecycle awareness.

Only explicit email and `Skills:` content can currently create proposals. Restricted work
authorization, sponsorship, demographic, disability, veteran, criminal-history, signature,
attestation, and consent answers are never inferred. OCR and AI extraction are not part of this
slice.

## Local verification

- event-contract validation and rejection tests pass;
- document parser/coordinator unit tests pass for generated synthetic PDF/DOCX, malicious archive
  boundaries, restricted-fact suppression, tag/metadata denial, and SQS partial failure;
- a disposable PostgreSQL 16 database passed Profile `0005` and Documents `0002` migration replay,
  proposal import/replay/correction, confirmed-fact invalidation, processing replay/contradiction,
  upload ownership/idempotency, and audit JSON integrity; the disposable database was then removed;
- document, Profile, and web TypeScript checks pass;
- deterministic coordinator/parser Lambda artifacts build with separate manifests and SBOMs;
- Terraform development/staging validation passes; all platform module tests pass; and
- formatting, lint, repository policy, dependency audit, and the full test matrix are recorded by
  the final batch verification run.

The same PostgreSQL integration suite must pass against the deployed development migration before
the processing trigger can be enabled; the local disposable run does not replace deployed evidence.

## Deployment sequence and next acceptance gate

1. Merge the exact verified revision, apply the updated bootstrap workload boundary, and verify that
   it permits the coordinator's narrowly scoped `sts:AssumeRole` while retaining the boundary's
   existing deny controls. The processor cannot mint exact-object sessions until this account-level
   prerequisite is applied.
2. Publish both immutable Lambda artifacts and verify their exact version, checksum, KMS encryption,
   and non-public artifact-bucket boundary after upload.
3. Publish the migration image and apply Profile `0005` plus Documents `0002` once.
4. Create the coordinator/parser, queues, rules, policies, endpoints, and alarms dark; independently
   review and checksum-bind the plan before applying.
5. Prove direct generated-synthetic clean, invalid, malware-test, duplicate, contradiction,
   rollback, alarm, log-redaction, and zero-drift cases while public use remains disabled.
6. Enable the SQS mapping and timeout reconciler first and the exact GuardDuty rule second, then
   perform candidate browser
   acceptance: upload a generated synthetic PDF/DOCX, observe terminal parsing, review proposals,
   confirm/edit/reject, refresh, and prove cross-user isolation.

The first product-owner manual gate is step 6. Earlier bootstrap, artifact publication, migration, and dark
infrastructure applies may proceed after independent agent review unless a reviewer finds material
drift, deletion, replacement, privilege expansion outside this decision, or an unsafe plan.

## Remaining real-data gates

- version-aware document/account deletion and non-resurrection reconciliation;
- portable export contents and secure delivery;
- independent review and treatment of the AWS-managed DNS covert-channel residual;
- accountable real-candidate privacy/security approval; and
- a later product decision on whether explicitly confirmed facts remain when their source resume
  is deleted. The recommended default is to retain those user-confirmed facts while deleting all
  source/normalized objects and unconfirmed proposals and marking evidence unavailable.

## References

- [ADR-022](../../../adr/022-quarantine-and-scan-candidate-document-uploads.md)
- [ADR-023](../../../adr/023-isolate-untrusted-document-parsing.md)
- [D1 task register](../phase-1-web-and-job-catalog.md)
- [Data-flow and classification](../../../security/data-flow-and-classification.md)
- [Threat model](../../../security/threat-model.md)
