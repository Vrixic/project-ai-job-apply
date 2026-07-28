# Documents Service

Owns immutable source resumes, normalized resume trees, tailored versions, cover letters, rendering state, version diffs, and artifact metadata.

## Planned subfolders

- `parsing/` — PDF/DOCX ingestion into the normalized document model.
- `tailoring/` — Evidence-grounded selection and rewriting.
- `rendering/` — PDF/DOCX generation and rendered-text verification.
- `factuality/` — Claim provenance, date, contradiction, and unsupported-claim checks.
- `storage/` — Encrypted object references and retention behavior.
- `api/` — Document commands and artifact reads.
- `tests/` — Golden parsing, generation, rendering, and factuality tests.

The service creates documents but does not approve or submit applications.
