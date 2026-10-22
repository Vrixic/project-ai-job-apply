# ADR-055: Notifications-owned inbox and delivery preferences

Status: Accepted by the owner's direction 2026-10-22; service and schema built, not deployed
Date: 2026-10-22

## Context

ADR-024 makes Notifications the sole owner of the generic in-app action inbox, preferences, routing,
delivery attempts and deduplication, as a projection of minimal versioned source-owner events. The
owner approved the new `notifications` schema on 2026-10-22 (D5-001, D5-002). Nothing consumes
Applications events yet, and there is no event transport in the deployed runtime.

## Decisions

1. **Own schema and package.** `backend/services/notifications` with a `notifications` PostgreSQL
   schema (`source_receipts`, `source_cursors`, `inbox_items`, `preferences`) and its own forward-only,
   checksum-verified migrations. No other module reads these tables.
2. **The inbox is a projection.** An item stores a kind, an urgency, a state, an opaque application
   reference and the source revision, never candidate content or a hiring outcome. Acknowledging,
   dismissing or expiring an item can never change the source fact, and an item can never authorize or
   prove an Applications transition.
3. **Only minimal versioned events.** The first consumer accepts exactly `application.status_changed.v1`
   and `application.applied.v1` payloads (application id, owner id, revision, status), strictly
   validated; anything else is rejected without effect. Items: `application_review_needed` (normal),
   `application_outcome_needed` (high; an unconfirmed submission risks a duplicate) and
   `application_confirmed` (low). A newer event resolves items it makes obsolete.
4. **Duplicate, replayed, late and out-of-order events fail closed.** A receipt per source event
   makes a replay a no-op; a per-application cursor makes an older revision stale; processing is
   serialized per application; an item is unique per owner, kind, application and revision.
5. **Preferences.** The in-app inbox cannot be turned off, because it is the fallback when external
   delivery fails. Email and push are off until the candidate turns them on. Quiet hours (an IANA time
   zone and a window that may wrap midnight) defer external channels except for an urgent item.
   Preference writes are compare-and-set on a version.
6. **Delivery is separate.** D5-002 (email and push providers, delivery attempts, fallback and
   reconciliation) builds on the routing decision this service produces. It needs a provider choice
   and credentials, which are the owner's, and any AWS service for it is not authorized here.
7. **Transport is a later step.** Until an event transport exists, the Gateway runtime calls
   `ingestApplicationEvent` in process after an Applications change. That adds no AWS resource.

## Consequences

- A ninth owner schema touches the restore manifest, candidate export and deletion, and the release
  tooling; each lands as its own change (candidate rights next).
- The in-process feed means an item can be missed if the process dies between the Applications commit
  and the notification call; the inbox is a convenience projection and the Applications state stays
  authoritative, so a later outbox-driven consumer can backfill.
