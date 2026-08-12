# Domain Schema Version 1

The first reviewed schema family covers candidate truth, answer reuse, canonical jobs, application
field ontology, immutable application packets, and consent records. `registry.json` records the
owner and classification of each schema.

`resume-document.schema.json` defines the normalized encrypted document-tree payload. Its block
text is confidential PII and must remain in the documents object-store boundary; events and
telemetry may carry only document/version identifiers and bounded counts.
