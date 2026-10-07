# D1 retention configuration readback — 2026-10-07

At 20:16–20:17 UTC the configured development managed AWS session was available. Read-only STS,
CloudWatch Logs configuration, SNS attributes/subscription metadata and Lambda name inventory
calls succeeded. No log events, notification bodies, candidate rows or secrets were read; no
alert, subscription change, publication or deployment was performed. Resource/account identifiers
and recipient addresses are excluded from this evidence.

| Checked development setting | Observed result |
|---|---|
| Exact application log retention | 30 days |
| Application log customer key configured | Yes |
| Operational alert topic customer key configured | Yes |
| Confirmed email subscriptions | One; zero pending subscriptions |
| SNS delivery feedback role configured | No |
| SNS message archive policy configured | No |
| Log groups matching the operational topic name | Zero |
| New privileged audit-retention Lambda present | No |
| New Jobs retention Lambda present | No |

SNS returns default sampling-rate attributes even without feedback roles. The initial inventory
was refined to check nonempty role attributes rather than treating any Feedback-named property
as an enabled delivery log. No alternate or historic log group can be ruled out solely by a
name match. Customer-key presence is configuration evidence, not a complete access-policy audit.
Sanitized local receipt: `.tmp/d1-retention-live-config-20261007.json`.

The accepted D1P-06 policy requires 30-day deletion of alert/incident delivery metadata while
retaining aggregate acceptance evidence. The maintained alert operator prints sanitized aggregate
status and never writes recipient addresses. These AWS settings do not prove deletion from the
recipient mailbox or other incident systems. Mailbox retention confirmation is requested;
no inbox access or automatic deletion is authorized or attempted.

The newly implemented Jobs/audit maintenance source and local acceptance must not be described
as deployed expiry. Their exact private Lambda names are absent in the current environment.
Publication, managed migration/runtime/grant/schedule/alert acceptance and accountable review
remain open. D1/D3 stay In progress; PC on, Docker/WSL stopped.
