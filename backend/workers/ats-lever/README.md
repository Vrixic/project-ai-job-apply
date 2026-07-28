# Lever ATS Worker

Implements and tests Lever-specific form inspection, field mapping, filling, validation, submission, and confirmation behavior.

## Planned subfolders

- `detection/` — Lever site/posting and page-state detection.
- `forms/` — Standard and tenant-specific form mappings.
- `actions/` — Fill, validate, submit, and confirm operations.
- `fixtures/` — Sanitized permitted Lever variants.
- `telemetry/` — Adapter-specific quality and failure metrics.
- `tests/` — Contract, rate-limit, fixture, and regression tests.

Lever's public postings capability does not imply permission to use employer-authenticated application APIs.
