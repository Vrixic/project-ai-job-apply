# D5 — Personalized Outreach and Application Notifications

- Status: In progress
- Start: 2026-10-22
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-08-17
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d5--personalized-outreach-and-application-notifications)

## Objective

Deliver a generic in-app action inbox, relevant application notifications, and authorized,
grounded candidate outreach without reading inboxes/calendars or tracking post-submission hiring
outcomes.

## Deployment posture

Use the existing durable worker and provider queues with bounded sending concurrency. Add
notification replicas or dedicated delivery services only from queue age, provider isolation,
rate limits, or measured volume; retain the in-app fallback regardless of capacity.

## Task register

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D5-001 | Implement the Notifications-owned generic action inbox, preferences, quiet hours, urgency, channel routing, and deduplication by consuming minimal versioned source-owner events. | In progress | Claude | D0 contracts; D3 Applications events and other owner events as their capabilities land; [ADR-024](../../adr/024-application-history-and-inbox-phase-ownership.md) | Inbox state is a derived projection and cannot authorize, cause, or prove a source transition. D5 has no D1 action-inbox dependency. 2026-10-22 owner approved the new schema ([ADR-055](../../adr/055-notifications-inbox-and-preferences.md)). Slice 1 built and tested against local PostgreSQL, not deployed: `backend/services/notifications` with migration 0001, strict consumption of `application.status_changed.v1` and `application.applied.v1`, idempotent receipts, per-application cursors (stale events refused), unique items, acknowledge/dismiss/expire that never touch the source, preferences with quiet hours and routing. Slice 2 (Gateway, not deployed): `GET /v1/notifications` (bounded `state`, `limit`, `cursor`), `POST /v1/notifications/{id}/acknowledgement` and `/dismissal`, `GET` and `PUT /v1/notifications/preferences` (compare-and-set), in the OpenAPI contract and the Lambda route table; the controller is registered only when `NOTIFICATIONS_ENABLED` is exactly `true`. Slice 3 (web, not deployed): same-origin BFF routes under `/api/platform/notifications`, an Inbox page with plain wording (mark as seen, dismiss, show more) and an Inbox link in the navigation that appears only when the platform serves an inbox; no delivery preferences are shown because nothing is delivered yet. Candidate rights, service level (not deployed): migration 0002 adds `notifications.export_candidate_data` and `notifications.delete_candidate_data` (privacy-ledger authorized, PUBLIC execute revoked), PostgreSQL-tested for exact-owner export, cross-candidate refusal and replay. Open before any deployment, and the schema is deliberately not in the migration runner list or the restore manifest yet: the aggregate rights wiring (a ninth owner in the policy, restore replay, export schema, policy document, Terraform inventory variable and tooling pins), the API Gateway routes (AWS), and the scheduled publisher. Slice 4 (feed, not deployed): the Applications-owned `ApplicationEventOutbox` (owner-scoped claim, lease, publish and retry over the existing outbox table, PostgreSQL-tested) and a gateway feed that, on the first page of an inbox read, takes the candidate's pending events and hands them to Notifications; a feed failure never fails the read. |
| D5-002 | Implement transactional email and push delivery with provider fallback/reconciliation. | In progress | Claude | D0 infrastructure | 2026-10-22 the routing decision (channel off, send now, defer past quiet hours) exists; providers, delivery attempts, fallback and reconciliation need the owner's email and push provider choice and credentials. |
| D5-003 | Implement permitted contact source/provider abstraction and provenance. | Ready | Unassigned | Legal/source review | Open |
| D5-004 | Implement grounded referral/recruiter drafts with recipient, evidence, and truthfulness checks. | Ready | Unassigned | D3 fact graph; D5-003 | Open |
| D5-005 | Implement send-only Gmail/Outlook OAuth with scope enforcement, revocation, and copyable-draft fallback. | Ready | Unassigned | D0 legal/security | Open |
| D5-006 | Implement explicit send approval, connected-account delivery, limits, suppression, and one restrained follow-up. | Ready | Unassigned | D5-004, D5-005 | Open |
| D5-007 | Implement delivery reconciliation, bounce/complaint handling, duplicate prevention, and disconnect/deletion. | Ready | Unassigned | D5-001–D5-006 | Open |
| D5-008 | Enforce and test the absence of inbox-reading, calendar, and post-submission status permissions/data flows. | Ready | Unassigned | D0 threat model | Open |
| D5-009 | Complete OAuth, anti-spam and grounding security testing. | Ready | Unassigned | D5-001–D5-008 | Open. Provider-failure, accessibility and product testing removed 2026-10-21 (owner decision). |
| D5-010 | Obtain contact-source, anti-spam, OAuth-provider, legal and security approval before any outreach send. | Ready | Legal counsel; security reviewers | Concrete sources, providers, scopes, consent UX and suppression controls | Release gate LR-D5-01; drafts may be tested synthetically but sending remains disabled. |

## Exit criteria

- [ ] Notification routing consistently respects consent, preferences, quiet hours, urgency, and deduplication.
- [ ] The in-app action record remains available when email/push delivery fails.
- [ ] Inbox reads are owner scoped; duplicate, replayed, delayed, out-of-order, stale, or missing
      owner events fail closed without changing or fabricating source truth.
- [ ] Acknowledging, dismissing, expiring, or failing an inbox item never changes the source-owned
      application or job fact.
- [ ] Connected-account authorization is send-only, minimal, verified, encrypted, revocable, and deletion-aware.
- [ ] Copyable outreach drafts remain available without a mailbox connection.
- [ ] No inbox messages, calendars, recruiter responses, interviews, offers, rejections, or other hiring outcomes are read or stored.
- [ ] Outreach contains no fabricated relationship, claim, application state, or candidate fact.
- [ ] Every outreach send is recipient/content/account/time approved and protected by limits/suppression.
- [ ] Duplicate-send prevention, revocation and deletion behave correctly. Provider-failure, bounce and complaint test passes were removed 2026-10-21.
- [ ] Legal and security evidence is complete. Accessibility and product acceptance were removed 2026-10-21.

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-08-17 | Accepted the Option A allocation of a D5-owned generic action inbox consuming minimal versioned Applications and other source-owner events without owning source truth. This governance change does not start D5 or authorize contracts, migrations, implementation, delivery providers, deployment, or real data. | D5-001 | [ADR-024](../../adr/024-application-history-and-inbox-phase-ownership.md), [approved D1 disposition](../foundation/d1-006-application-history-ownership-review-disposition.md) |
| 2026-07-28 | Assigned outreach delta approval to D5 without starting implementation. | D5-010 | [Legal review register](../foundation/legal-review-register.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-08-17 | Make D5 the sole owner of the generic in-app action inbox and remove its former D1 inbox dependency. | A derived Notifications projection can preserve candidate actions and delivery fallback without becoming a parallel Applications lifecycle. | [ADR-024](../../adr/024-application-history-and-inbox-phase-ownership.md) |
| 2026-07-28 | Removed inbox/calendar parsing and all post-submission status tracking; retained send-only approved outreach. | Focus the product on rapid, tailored, confirmed applications. | Updated architecture and delivery tracker |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D5-R1 | Open | Mail providers may still require review for send-only scopes. | Unassigned | Request only sending permission and complete provider/security review before OAuth launch. |
| D5-R2 | Open | Automated outreach can become spam or misrepresent the candidate. | Unassigned | Require grounding, explicit approval, limits, suppression, and no bulk sequences. |
| D5-R3 | Open | Scope creep could reintroduce inbox reading or hiring-outcome tracking. | Unassigned | Add scope/data-flow tests and explicit product/privacy prohibitions. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
