# Ashby ATS Worker

Implements and tests Ashby-specific dynamic form inspection, field mapping, filling, validation, submission, and confirmation behavior.

## Planned subfolders

- `detection/` — Ashby board, posting, and page-state detection.
- `forms/` — Dynamic and custom-question mappings.
- `actions/` — Fill, validate, submit, and confirm operations.
- `fixtures/` — Sanitized permitted Ashby variants.
- `telemetry/` — Adapter-specific quality and failure metrics.
- `tests/` — Contract, dynamic-form, fixture, and regression tests.

The public posting API is used only according to its terms and remains separate from candidate application authorization.
