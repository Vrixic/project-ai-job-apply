# Validation

Owns the canonical application-field ontology and deterministic validators shared by profile, documents, applications, extension, and ATS workers.

## Planned subfolders

- `ontology/` — Stable concepts such as contact, employment, authorization, and voluntary fields.
- `validators/` — Dates, URLs, phone, salary, address, and file constraints.
- `normalizers/` — Deterministic canonical value conversion.
- `sensitivity/` — Data-classification and mandatory-review policies.
- `messages/` — User-safe validation codes and localization keys.
- `tests/` — Boundary, contradiction, and serialization tests.

Model confidence never bypasses a deterministic validation or mandatory-review policy.
