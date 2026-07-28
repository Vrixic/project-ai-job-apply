# Messaging Workers

Deliver authorized transactional email, candidate outreach, push notifications, webhooks, and scheduled digests.

## Planned subfolders

- `email/` — Transactional and user-approved sending.
- `push/` — APNs/FCM delivery.
- `webhooks/` — Outbound webhook signing, retry, and status.
- `digests/` — Scheduled collapse and digest assembly.
- `providers/` — Delivery-provider adapters.
- `suppression/` — Bounce, complaint, unsubscribe, and duplicate controls.
- `tests/` — Idempotency, provider failure, suppression, and rendering tests.

Workers execute decisions made by notification/outreach services and never independently choose recipients or content.
