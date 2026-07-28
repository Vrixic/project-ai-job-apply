# Shared Test Fixtures

Contains sanitized, synthetic, and legally permitted fixtures used by multiple packages, services, clients, and adapter tests.

## Planned subfolders

- `ats/` — Sanitized HTML/DOM/form variants by provider.
- `jobs/` — Canonical and malformed job observations.
- `resumes/` — Synthetic PDF/DOCX/text resumes.
- `applications/` — Synthetic packets, fields, and confirmation evidence.
- `emails/` — Synthetic transactional, approved-outreach, delivery, bounce, and complaint messages.
- `security/` — Malicious HTML, prompt injection, redirect, and upload cases.
- `expected/` — Golden normalized and validated outputs.

Every fixture must be synthetic or explicitly sanitized; production user data is prohibited.
