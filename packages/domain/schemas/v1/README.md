# Domain Schema Version 1

The first reviewed schema family covers candidate truth, answer reuse, canonical jobs, application
field ontology, immutable application packets, and consent records. `registry.json` records the
owner and classification of each schema.

`resume-document.schema.json` defines the normalized encrypted document-tree payload. Its block
text is confidential PII and must remain in the documents object-store boundary; events and
telemetry may carry only document/version identifiers and bounded counts.

`saved-job.schema.json` defines the Matching-owned Confidential association. It preserves the
owner, immutable requested target, resolved canonical identifier at save time, and a bounded public
snapshot; descriptions, source payloads, profile data, and post-submission outcomes are forbidden.

`candidate-data-export.schema.json` is the portable Profile-owned candidate-rights envelope. It
contains candidate-readable values and bounded metadata from every Phase 1 owner, but deliberately
excludes OIDC subjects, access/refresh tokens, database-only ownership identifiers, object-store
keys/versions, raw resume bytes, provider credentials, and unrestricted audit metadata.
