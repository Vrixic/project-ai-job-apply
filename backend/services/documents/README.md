# Documents Service

Owns immutable source resumes, normalized resume trees, tailored versions, cover letters,
rendering state, version diffs, and artifact metadata.

## Current Phase 1 slice

- `migrations/` owns candidate-resume metadata, idempotency, processing receipts, and value-free
  audit records in the `documents` PostgreSQL schema.
- `src/upload-signer.ts` creates five-minute exact-key S3 POST grants with media type, byte range,
  SHA-256 metadata, and customer-managed KMS conditions.
- `src/index.ts` owns candidate-scoped resume registration/listing and never returns bucket keys,
  object versions, normalized content, or extracted text.
- `src/processor.ts` owns fail-closed malware-result transitions and normalized-object metadata;
  resume bytes and block text remain behind the object-store boundary.
- `src/parsing/` performs bounded PDF/DOCX magic, archive, page, and text normalization after a
  clean malware disposition.
- `tests` use synthetic generated documents only. Real resumes are forbidden.

## Planned expansion

- `tailoring/` — Evidence-grounded selection and rewriting.
- `rendering/` — PDF/DOCX generation and rendered-text verification.
- `factuality/` — Claim provenance, date, contradiction, and unsupported-claim checks.
- `api/` — Later artifact reads, deletion, and version selection.

The service creates documents but does not approve or submit applications. Parsed values become
proposals and cannot be used as confirmed facts without explicit candidate action.
