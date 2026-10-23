# Notifications Service

Owns notification preferences, quiet hours, templates, channel selection, deduplication, in-app inbox records, and delivery outcomes.

## Planned subfolders

- `preferences/` — Channel, cadence, locale, and quiet-hour settings.
- `routing/` — Urgency, channel, collapse, and fallback decisions.
- `templates/` — Versioned transactional and product notification content.
- `inbox/` — Durable in-app action and notification records.
- `delivery/` — Provider-neutral delivery commands and status.
- `tests/` — Preference, idempotency, localization, and fallback tests.

Built so far: preferences, quiet hours, routing, the inbox projection, and email and push delivery ([ADR-055](../../../docs/adr/055-notifications-inbox-and-preferences.md), [ADR-056](../../../docs/adr/056-notification-email-and-push-delivery.md)). Delivery lives in `src/delivery*.ts`, `src/dispatcher.ts` and `src/providers/` (subpath `@ai-job-apply/notifications-service/providers`).

The service routes an already-authorized notification; it does not decide application or billing truth.
