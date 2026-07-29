# ATS Fixture Acquisition and Sanitization Policy

Status: Process defined; representative acquisition blocked by legal review
Accountable roles: QA/automation and legal/privacy counsel

## Allowed inputs

- Fully synthetic HTML/forms created for tests
- Public provider examples whose terms explicitly permit the intended capture and storage
- Controlled employer test tenants with written authorization
- User-provided pages only with specific consent and a documented lawful storage purpose

## Prohibited inputs

- Production candidate resumes, answers, credentials, cookies, tokens, or demographic data
- Pages captured behind authentication without written authorization
- CAPTCHA/MFA artifacts or remote-browser recordings
- Third-party fixtures with uncertain provenance

## Sanitization

1. Assign a source/provenance record before capture.
2. Remove names, emails, phones, addresses, account IDs, cookies, tokens, hidden identifiers,
   tracking parameters, and free-text candidate content.
3. Replace companies, jobs, URLs, and people with obviously synthetic values.
4. Run secret and PII scanners plus human review.
5. Store the sanitized fixture with a checksum, provider family, behavior tags, reviewer, capture
   policy version, and permitted retention.
6. Reject rather than partially redact a fixture when provenance or safe sanitization is unclear.

Raw captures use an access-controlled quarantine and a maximum provisional retention of 30 days.
Only approved sanitized fixtures enter source control.
