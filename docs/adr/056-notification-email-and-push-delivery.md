# ADR-056: Email and push delivery for notifications

Status: Accepted by the owner's direction 2026-10-23; deployed to development 2026-10-23
Date: 2026-10-23

## Context

ADR-055 gives Notifications an inbox, preferences and a routing decision, and leaves delivery
(D5-002) open. On 2026-10-23 the owner chose to add email and push now, before search and matching
algorithms land, instead of staying in-app only. The owner did not name providers. The inbox stays
the fallback when external delivery fails, and an item carries only a classification and an opaque
reference, never candidate content.

## Amendment 2026-10-24: browser push removed

The owner decided browser push is not a feature the product wants. The service worker, the browser
subscription API, the push provider, the VAPID runtime and every candidate-facing push route and
setting are gone, and a delivery attempt is email only. Decisions 2 and 7 and the push parts of
decisions 3 to 5, 8 and 9 below are withdrawn and kept as history. The `push_subscriptions` table,
the `push_enabled` column and their export and deletion coverage stay until the next Notifications
schema change, because dropping them changes the restore manifest and the candidate-rights
contract; they are never written. The VAPID secret container and its Terraform were removed on
2026-10-26.

## Decisions

1. **Email through Amazon SES.** It stays in the account, authenticates with the Lambda role (no
   third-party secret), and supports bounce and complaint reporting later. Testing starts in the SES
   sandbox against a verified address. Moving out of the sandbox and verifying a sender domain are
   owner steps (AWS support case, DNS records in the applydash.ai zone).
2. **Push through standard Web Push.** The browser subscribes through a service worker, the platform
   signs a VAPID token (ES256, `node:crypto`, no new dependency) and posts to the subscription
   endpoint. The push carries no payload, so nothing about the candidate or an application ever
   reaches a push service. The service worker shows generic wording and opens the inbox. No payload
   encryption keys are stored.
3. **Delivery attempts are rows.** One `delivery_attempts` row per inbox item and channel
   (unique), created when the item is created and the candidate has the channel on and a usable
   destination. A scheduled dispatcher claims due rows with `FOR UPDATE SKIP LOCKED` and a lease, so
   concurrent runs cannot double-send and a crashed run is reclaimed. Delivery is at least once: a
   crash between a provider accepting a message and the row being marked sent can send a duplicate.
4. **Everything is re-checked at send time.** The dispatcher re-reads preferences, the destination
   and the item. A resolved, dismissed, acknowledged or expired item, a channel turned off, or a
   missing destination marks the attempt skipped. Quiet hours defer a non-urgent item.
5. **Retries and fallback.** Transient failures retry with backoff (1 minute, 5 minutes, 30 minutes,
   2 hours) up to five attempts, then the attempt is failed. A permanent email rejection suppresses
   the address. A push endpoint answering 404 or 410 expires that subscription. None of this changes
   the inbox item.
6. **The notification address is the account address.** Amended 2026-10-24 at the owner's direction
   (sign-up already needs an email, so asking again was redundant). The first design had the candidate
   type an address and confirm it with a six digit code. Now the web app forwards the session's ID
   token as the identity proof, the Gateway verifies its signature, issuer, audience and expiry,
   requires its subject to match the access token, and reads the address only when the provider
   states `email_verified`. A browser never names an address, and an access-token claim is never used
   for it. An unverified provider address records nothing, so email stays off. A changed account
   address replaces the old one the next time Settings opens and cancels mail scheduled to the old
   one. An address suppressed after a permanent rejection stays suppressed until the account address
   changes. One address per candidate. The code columns from migration 0003 are unused and stay,
   because migrations are forward-only.
7. **Push endpoints are allow-listed.** The platform posts only to https endpoints on the known push
   services (Google FCM, Mozilla, Apple, Windows), with no credentials, port 443 only and no
   redirects, so a candidate cannot aim the dispatcher at another host. At most five subscriptions
   per candidate.
8. **Rights.** Migration 0003 replaces the export and deletion functions so the email destination,
   push subscriptions and delivery attempts are exported and deleted with the rest of the
   Notifications owner data. The push endpoint is a capability URL, so the export lists its host and
   identifier only.
9. **Where it runs.** The dispatcher is a scheduled action of the existing workflow activity Lambda
   (the same pattern as candidate rights maintenance), so it needs no new artifact pipeline. It needs
   `ses:SendEmail` scoped to the sender identity, the VAPID private key in a secret, and the same
   private egress the other external-calling Lambdas use.

## Out of scope for this slice

Bounce and complaint feeds from SES (a configuration set with an event destination), marketing mail,
payload push, and mobile or extension push. The transactional mail contains no application detail.

## Consequences

- The ninth-owner rights wiring and the AWS resources land as their own changes before any
  deployment; `NOTIFICATIONS_ENABLED` stays off until then.
- Duplicate sends are possible after a crash; the mail and the push are idempotent in meaning (open
  your inbox).
- Delivery cost is SES per message plus the NAT egress already used by other Lambdas.
