# Notifications Service

Owns notification preferences, quiet hours, templates, channel selection, deduplication, in-app inbox records, and delivery outcomes.

## Planned subfolders

- `preferences/` — Channel, cadence, locale, and quiet-hour settings.
- `routing/` — Urgency, channel, collapse, and fallback decisions.
- `templates/` — Versioned transactional and product notification content.
- `inbox/` — Durable in-app action and notification records.
- `delivery/` — Provider-neutral delivery commands and status.
- `tests/` — Preference, idempotency, localization, and fallback tests.

The service routes an already-authorized notification; it does not decide application or billing truth.
