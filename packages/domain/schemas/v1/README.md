# Domain Schema Version 1

The first reviewed schema family covers candidate truth, answer reuse, canonical jobs, application
field ontology, immutable application packets, and consent records. `registry.json` records the
owner and classification of each schema.

`resume-document.schema.json` defines the normalized encrypted document-tree payload. Its block
text is confidential PII and must remain in the documents object-store boundary; events and
telemetry may carry only document/version identifiers and bounded counts. A PDF's blocks may also
carry an optional `layout` (positions, sizes, font traits, colors and rules of the source line,
with the same words in each run) and the document a `page` size, all or none, so a tailored copy
can be drawn the way the candidate's own resume was set. Documents parsed before this addition
have neither and are drawn as plain text.

`saved-job.schema.json` defines the Matching-owned Confidential association. It preserves the
owner, immutable requested target, resolved canonical identifier at save time, and a bounded public
snapshot; descriptions, source payloads, profile data, and post-submission outcomes are forbidden.

`candidate-data-export.schema.json` is the portable Profile-owned candidate-rights envelope. It
contains candidate-readable values and bounded metadata from every active candidate-rights owner,
including reviewer-redacted Trust cases, decisions, and contributor reputation evidence and the
optional Applications section (packets and answers, approvals, attempts, and technical history, with no
hiring outcomes or internal identifiers), but deliberately
excludes OIDC subjects, access/refresh tokens, database-only ownership identifiers, object-store
keys/versions, raw resume bytes, provider credentials, and unrestricted audit metadata.

The optional `documents.coverLetters` section adds Documents-owned pending/ready draft metadata:
public document/application identities, version, job/evidence content hashes, model/prompt
identity and creation time. Pending rows cannot carry readiness-only fields. It excludes raw
text, prompts and object capabilities. Artifact-content export assembly remains in progress
with D3-017; metadata validation alone is not full draft portability or runtime activation.

The optional `profile.restrictedAnswers` section accepts the latest-version metadata projection
from Profile migration `0010_restricted_answer_vault`, including active entries and deletion
tombstones. It does not accept plaintext values, ciphertext, KMS identifiers, or provenance
references in the metadata-only SQL projection. Older exports may omit the section or saved values.
Separately activated candidate-rights assembly may add the bounded string `value` to active
entries, including expired answers; deleted entries cannot contain it. Superseded values are
excluded. See [ADR-035](../../../../docs/adr/035-restricted-answer-values-in-candidate-export.md).
