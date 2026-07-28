# Browser Automation Workers

Provide ephemeral, isolated remote browser sessions for eligible application preparation and submission workflows.

## Planned subfolders

- `runtime/` — Browser/container lifecycle and resource limits.
- `sessions/` — Encrypted session handoff and destruction.
- `network/` — Egress policies, domain allowlists, and redirect checks.
- `takeover/` — Secure user interaction for login, MFA, CAPTCHA, and ambiguity.
- `artifacts/` — Redacted diagnostics with strict retention.
- `orchestration/` — ATS adapter execution and structured result reporting.
- `tests/` — Isolation, timeout, takeover, redirect, and cleanup tests.

These workers never bypass security controls and never blindly retry an ambiguous final submission.
