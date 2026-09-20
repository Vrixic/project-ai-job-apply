# Documents Service

Owns immutable source resumes, normalized resume trees, tailored versions, cover letters,
rendering state, version diffs, and artifact metadata.

## Current Phase 1 slice

- `migrations/` owns candidate-resume metadata, idempotency, processing receipts, and value-free
  audit records in the `documents` PostgreSQL schema.
- `src/upload-signer.ts` creates five-minute exact-key S3 POST grants with media type, byte range,
  SHA-256 metadata, and customer-managed KMS conditions.
- `src/index.ts` owns candidate-scoped resume registration/listing and never returns bucket keys,
  object versions, normalized content, or extracted text. It also enforces the plan's stored-resume limit
  and one-upload-at-a-time rule ([ADR-032](../../../docs/adr/032-billing-owned-plan-limits-enforced-by-owning-contexts.md))
  and candidate deletion, a tombstone that hides and frees the resume but keeps its objects until a separate
  purge ([ADR-033](../../../docs/adr/033-resume-deletion-is-a-tombstone-with-a-separate-byte-purge.md)).
- `src/processor.ts` owns fail-closed malware-result transitions and normalized-object metadata;
  resume bytes and block text remain behind the object-store boundary.
- `src/parsing/` performs bounded PDF/DOCX magic, archive, page, and text normalization after a
  clean malware disposition.
- `tests` use synthetic generated documents only. Real resumes are forbidden.

## D3 slice (source and local verification only)

- `src/resume-ast/` builds the normalized resume tree from one immutable normalized document. Every block becomes exactly one node with an exact span; nothing is rewritten.
- `src/tailoring/` selects and orders verbatim bullets by job-term overlap, produces a fixed-reason visible diff, and gates structural factuality (no new text, no cross-entry moves).
- `src/render/` renders DOCX and PDF from a tailored variant and verifies each artifact by re-parsing it with the production parser and comparing text. PDF supports the standard Latin font only.

- `src/resume-tailoring.ts` serves the fixed `resume-tailoring-v1` request from the document processor ([ADR-031](../../../docs/adr/031-deterministic-resume-tailoring-in-documents-runtime.md)): an owner-scoped parsed-resume lookup, the verified normalized read, deterministic tailoring, and verified DOCX/PDF rendering. Nothing is persisted beyond the content hash the packet stores. The dependency-free wire contract is `src/resume-tailoring-contract.ts`, which the Gateway imports.

Generative rewrites and cover letters are not implemented here; they need grounded generation (D3-004) and review.

## Planned expansion

- `tailoring/` — Evidence-grounded selection and rewriting.
- `rendering/` — PDF/DOCX generation and rendered-text verification.
- `factuality/` — Claim provenance, date, contradiction, and unsupported-claim checks.
- `api/` — Later artifact reads, deletion, and version selection.

The service creates documents but does not approve or submit applications. Parsed values become
proposals and cannot be used as confirmed facts without explicit candidate action.
