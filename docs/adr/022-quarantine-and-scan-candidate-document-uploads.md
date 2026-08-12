# ADR-022: Quarantine and Scan Candidate Document Uploads

Status: Accepted
Date: 2026-08-12

## Context

Resumes are untrusted confidential PII. Sending their bytes through API Gateway/Lambda would add
payload limits, memory copies, and accidental logging risk. Storing them in the deployment-artifact
bucket would also combine product data with release artifacts and grant the wrong identities
access to candidate content.

Parsing a file before its type and malware disposition are known can expose the parser to active
content, archive expansion, malformed structures, and resource exhaustion. Browser-declared MIME
type and filename are not security decisions.

## Decision

Each active environment uses a separate private candidate-document bucket encrypted with the
environment customer-managed KMS key. The browser receives one short-lived, exact-key presigned
POST from an authenticated owner-scoped command. The POST policy fixes the key, media type,
encryption headers, document/checksum metadata, and a one-byte-to-five-MiB content-length range.
Initial intake accepts PDF and DOCX only.

Every source upload enters `quarantine/`. GuardDuty Malware Protection for S3 scans that prefix and
adds its managed disposition tag. No application identity may read an object unless its tag is
`GuardDutyMalwareScanStatus=NO_THREATS_FOUND`. An identifier-only EventBridge/SQS handoff invokes
the document processor with at-least-once/idempotent semantics. `THREATS_FOUND`, `UNSUPPORTED`,
`ACCESS_DENIED`, `FAILED`, missing, or contradictory results never reach a parser.

After the clean gate, the processor independently verifies object size, SHA-256, media-type magic,
PDF page/character limits, and DOCX archive entry/uncompressed-size limits. It writes a normalized,
KMS-encrypted document tree under an immutable document/version key and persists only object
references and bounded metadata in PostgreSQL. Resume bytes and extracted text are forbidden from
queues, events, logs, traces, analytics, audit metadata, and fixtures.

Parsed facts are proposals with resume/document provenance and supporting spans. They require
explicit candidate confirmation or rejection before any application can use them. Parsing never
silently converts a proposal into a confirmed profile fact.

Development and staging remain synthetic-only until real-candidate onboarding, deletion/export,
retention, and accountable security/privacy gates pass.

## Consequences

- Upload traffic bypasses the gateway data plane while authentication and ownership remain in the
  API command that creates the exact upload capability.
- There is no continuously provisioned scanner. GuardDuty is pay per object/byte, with its current
  account-region monthly free allowance applying before usage charges.
- The candidate-document bucket, scan role, queue, processor, lifecycle, alarms, and policies are
  owned infrastructure and require deployment evidence before the web upload control is enabled.
- Account/document deletion must remove the owned database records and every corresponding source
  and normalized object version; object retention cannot be inferred from database deletion.

## Alternatives

- **Upload through the gateway.** Rejected because resume bytes do not belong in request logs or
  Lambda memory and API Gateway is the wrong large-object transport.
- **Use the deployment artifact bucket.** Rejected because immutable release artifacts and
  candidate PII require different ownership, access, lifecycle, and incident boundaries.
- **Run ClamAV continuously.** Rejected for the initial architecture because maintaining engines,
  signatures, capacity, and warm compute adds operational failure modes already covered by the
  managed scan service.
- **Trust extension/MIME or scan after parsing.** Rejected because client metadata is untrusted and
  parsing is itself an attack surface.
