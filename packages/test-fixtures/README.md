# Shared Test Fixtures

Contains sanitized, synthetic, and legally permitted fixtures used by multiple packages, services,
clients, and adapter tests.

## Contents

- `ats/` — Integrity-pinned synthetic or explicitly authorized and sanitized application-form
  fixtures, a versioned manifest contract, and a fail-closed validator. Passing validation does not
  establish source authorization or representative-provider evidence.

## Planned subfolders

- `jobs/` — Canonical and malformed job observations.
- `resumes/` — Synthetic PDF/DOCX/text resumes.
- `applications/` — Synthetic packets, fields, and confirmation evidence.
- `emails/` — Synthetic transactional, approved-outreach, delivery, bounce, and complaint messages.
- `security/` — Malicious HTML, prompt injection, redirect, and upload cases.
- `expected/` — Golden normalized and validated outputs.

Every fixture must be synthetic or explicitly authorized, sanitized, and reviewed under its owning
policy. Production user data and raw provider captures are prohibited.
