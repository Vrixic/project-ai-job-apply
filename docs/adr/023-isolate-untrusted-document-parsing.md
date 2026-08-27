# ADR-023: Isolate Untrusted Document Parsing from Candidate Data

Status: Accepted
Date: 2026-08-12
Accepted: 2026-08-27
Extends: [ADR-022](022-quarantine-and-scan-candidate-document-uploads.md)

## Context

ADR-022 established direct encrypted quarantine, managed malware scanning, bounded parsing, and
explicit candidate review. A parser still operates on attacker-controlled PDF and DOCX bytes.
Giving that parser database credentials or general network access would let a parser exploit move
directly into candidate records. Combining orchestration and parsing would also make that privilege
separation difficult to test and preserve.

GuardDuty scan-result delivery is at least once. The official event identifies the exact malware
protection plan in `resources[0]`; scan disposition alone is not authority to read an object.

## Decision

Use two scale-to-zero private Lambda functions:

1. An identifier-only EventBridge transformer sends exact GuardDuty scan results to an encrypted
   SQS queue. The envelope retains the account, region, protection-plan ARN, bucket, exact object
   key/version, disposition, event ID, and time—but no threat names, filenames, hashes, or content.
2. A coordinator Lambda owns PostgreSQL state transitions, delivery receipts, idempotency, and the
   Profile proposal-import port. It never parses source bytes.
3. For a clean result, the coordinator assumes a 15-minute object-access role with an inline
   session policy restricted to the exact source object version, exact deterministic output key,
   and KMS-via-S3 operations. It passes those temporary credentials to one immutable numeric
   parser Lambda version. The parser execution role has no database secret, S3 permission,
   application-log permission, X-Ray permission, or internet route.
4. Before reading bytes, the parser independently verifies the exact object version, managed clean
   tag, KMS key, metadata, size, media type, and SHA-256. It applies bounded PDF/DOCX parsing and
   writes one deterministic normalized JSON object.
5. The coordinator verifies the exact normalized object version, metadata, digest, and schema,
   then atomically marks the document parsed and imports only proposed facts with block/offset
   evidence. Confirmed-fact consumers never see proposals as usable facts.

The SQS mapping and GuardDuty EventBridge rule deploy independently disabled. The mapping and
timeout reconciler must pass first; only a later reviewed plan may enable the exact GuardDuty rule.
General staging traffic activation never enables document processing. Neither function uses
provisioned concurrency or always-on compute.

## Consequences

- A parser compromise cannot directly read or mutate PostgreSQL. Effective object access is
  restricted per invocation and the parser cannot write application logs or traces.
- Delivery replay and a crash between normalized-object creation and database commit are safe:
  deterministic object identity and database receipts converge without duplicate proposals.
- A contradictory disposition or source version creates a security hold, system-invalidates every
  latest fact evidenced by that document (including a previously confirmed fact), emits a
  value-free alarm signal, and requires a new upload/review.
- AWS-managed VPC DNS remains reachable even without a routed internet path. Because it can be a
  covert channel after parser compromise, real-candidate processing remains a hard activation gate
  until an independent review accepts a concrete DNS-control treatment. Synthetic parser testing
  does not waive that gate.
- PDF parsing combines raw name-escape rejection, resolved JavaScript/attachment/form inspection,
  annotation checks, disabled evaluator execution, strict content limits, and a 45-second Lambda
  kill boundary. This reduces rather than eliminates third-party parser risk; adversarial corpus,
  dependency, and deployed IAM tests remain activation evidence.
- PDF image-only/OCR input and AI extraction are intentionally unsupported in this slice.
- Source/normalized deletion, portable export, DNS treatment, and accountable parser review remain
  release gates before real-candidate use.

## Acceptance scope

The repository product owner accepted this architecture on 2026-08-27 and accepted the documented
AWS-managed DNS covert-channel risk only for generated-synthetic development processing. That
residual risk is not accepted for real documents. The accepted activation authority is limited to
the mapping/reconciler-first generated-synthetic sequence; the GuardDuty rule remains independently
disabled until that sequence passes. Real resumes remain blocked by candidate-rights execution,
deletion/export/restore reconciliation, an accepted DNS-control treatment, and final attributable
security/privacy/product review.

## Alternatives

- **One privileged processor Lambda.** Rejected because parsing untrusted bytes would share the
  database trust boundary.
- **Send parsed text through SQS or Lambda results.** Rejected because content would spread into
  transport, dead-letter, logging, and observability surfaces.
- **Trust the EventBridge clean result without checking the S3 tag.** Rejected because post-scan
  tagging can fail and event delivery is not object-read authorization.
- **Use OCR or a model during parsing.** Deferred because deterministic text extraction is enough
  for the current slice and avoids a new provider/data-processing boundary.
