# D1 Secure Resume Intake Foundation — 2026-08-12

## Outcome

The first secure resume-intake boundary is implemented and locally verified. It is not deployed.
An authenticated candidate can register a PDF or DOCX up to 5 MiB, upload it directly through an
exact five-minute S3 POST grant, and list only their own document metadata. Candidate bytes do not
pass through API Gateway, the web BFF, PostgreSQL, logs, events, or audit metadata.

This slice intentionally stops before parsing. A deployed upload remains quarantined until the
managed scan-result consumer and bounded parser are implemented. No resume-derived fact can yet be
created, and no extracted claim can be silently confirmed.

## Implemented boundary

- OpenAPI defines `GET /v1/resumes` and `POST /v1/resumes/uploads` with dedicated
  `documents:read` and `documents:write` scopes, strict filenames/media types, exact byte size,
  lowercase SHA-256, idempotency, and metadata-only responses.
- The documents-owned PostgreSQL migration stores owner-scoped metadata, immutable document
  identity, scan/parse state, processing receipts, and value-free audit events. The composed
  migration image applies the documents schema after identity/profile and jobs schemas.
- The gateway uses the same documents service in local and Lambda composition roots, maintains an
  exact route allowlist, requires the dedicated scopes, and returns fail-closed `503` behavior when
  intake is not configured.
- The web client hashes the selected file locally, registers metadata through the server-held-token
  BFF, appends every signed S3 form field, and appends the file last. It never receives AWS
  credentials or document read/list authority.
- Terraform defines an off-by-default, separate candidate-document bucket with bucket-owner
  enforcement, versioning, all public-access blocks, KMS encryption, exact-origin POST-only CORS,
  and encryption-deny policy. Gateway IAM can sign only `PutObject` under `quarantine/` and only
  generate a data key for the platform CMK.
- GuardDuty Malware Protection for S3 is scoped to `quarantine/`, uses a dedicated bounded role,
  adds its managed scan-result tag, and has an explicit propagation dependency. No always-on
  compute was added.

## Security and privacy behavior

- File extension and media type must agree; only PDF and DOCX are accepted.
- The signed policy binds the exact bucket key, content type, document ID, declared SHA-256, KMS
  key, response status, and exact content length. Grants expire in 60–300 seconds.
- Storage keys, object versions, signed fields, and candidate content are absent from list
  responses, application telemetry, and audit metadata.
- Infrastructure remains synthetic-only. Real resume use remains blocked by the unfinished
  deletion/export workflow, scan-result consumer, safe parser, proposed-fact review, and applicable
  D1 security/privacy acceptance.

## Verification

- API contract generation and all eight contract tests pass, including traversal, unsupported
  type, oversize, and unknown-field rejection.
- Upload signer tests pass for exact signed-policy conditions, five-minute expiry, unrelated key,
  invalid digest, oversize file, and excessive TTL rejection.
- A fresh disposable PostgreSQL 16 database applied profile migrations through `0004` and the
  documents migration twice, then passed owner isolation, idempotent replay, conflict rejection,
  value-free audit, hidden storage-key, and immutable-identity cases. The database was removed.
- Gateway tests pass for registration/listing, dedicated-scope denial, metadata redaction, and the
  existing API/Lambda boundaries.
- Web type checking and all 40 web tests pass.
- Terraform validates in the platform, development, and staging roots. Eight module tests pass,
  including the new private/encrypted/quarantine/GuardDuty assertions.
- The deterministic Lambda package builds successfully with SHA-256
  `5ec2c2a2b1c79880f76ee1edf96ac312a544d90f3af546197e7d9d3787e1f832` from the current
  unmerged worktree. This digest is verification evidence only and must not be deployed; the exact
  merged commit must be rebuilt and published.
- Formatting, lint, and all 24 repository type-check dependency tasks pass.

## Remaining deployment and product gates

1. Merge this batch, rebuild exact merged artifacts, and publish the migration image and gateway
   ZIP with SBOM/checksum evidence.
2. Add `documents:read` and `documents:write` to the Auth0 API and authorize the development web
   application for both scopes; then sign out/in to obtain a fresh session.
3. Generate and review a development Terraform plan with document intake enabled and only the
   exact localhost conformance origin. Applying that plan is a material AWS/security change and
   requires explicit product-owner approval.
4. Apply the documents migration and release the gateway only after the bucket and scan plan are
   healthy.
5. Implement the idempotent GuardDuty scan-result consumer, bounded PDF/DOCX parser, normalized
   encrypted representation, and explicit proposed-fact review before accepting a full resume
   import.
6. Run synthetic PDF and DOCX upload, expiry, wrong-type/size, cross-user, malware-result,
   observability, rollback, restore, and zero-drift acceptance. Do not use a real resume.

## Official implementation references

- [GuardDuty Malware Protection for S3 operation and at-least-once results](https://docs.aws.amazon.com/guardduty/latest/ug/how-malware-protection-for-s3-gdu-works.html)
- [Required GuardDuty scan-role policy](https://docs.aws.amazon.com/guardduty/latest/ug/malware-protection-s3-iam-policy-prerequisite.html)
- [S3 POST policy construction](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html)
