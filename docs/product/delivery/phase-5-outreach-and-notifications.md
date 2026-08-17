# D5 — Personalized Outreach and Application Notifications

- Status: Not started
- Start: Not started
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
| D5-001 | Implement the Notifications-owned generic action inbox, preferences, quiet hours, urgency, channel routing, and deduplication by consuming minimal versioned source-owner events. | Ready | Unassigned | D0 contracts; D3 Applications events and other owner events as their capabilities land; [ADR-024](../../adr/024-application-history-and-inbox-phase-ownership.md) | Inbox state is a derived projection and cannot authorize, cause, or prove a source transition. D5 has no D1 action-inbox dependency. |
| D5-002 | Implement transactional email and push delivery with provider fallback/reconciliation. | Ready | Unassigned | D0 infrastructure | Open |
| D5-003 | Implement permitted contact source/provider abstraction and provenance. | Ready | Unassigned | Legal/source review | Open |
| D5-004 | Implement grounded referral/recruiter drafts with recipient, evidence, and truthfulness checks. | Ready | Unassigned | D3 fact graph; D5-003 | Open |
| D5-005 | Implement send-only Gmail/Outlook OAuth with scope enforcement, revocation, and copyable-draft fallback. | Ready | Unassigned | D0 legal/security | Open |
| D5-006 | Implement explicit send approval, connected-account delivery, limits, suppression, and one restrained follow-up. | Ready | Unassigned | D5-004, D5-005 | Open |
| D5-007 | Implement delivery reconciliation, bounce/complaint handling, duplicate prevention, and disconnect/deletion. | Ready | Unassigned | D5-001–D5-006 | Open |
| D5-008 | Enforce and test the absence of inbox-reading, calendar, and post-submission status permissions/data flows. | Ready | Unassigned | D0 privacy/threat model | Open |
| D5-009 | Complete OAuth, privacy, anti-spam, grounding, provider-failure, accessibility, and product testing. | Ready | Unassigned | D5-001–D5-008 | Open |
| D5-010 | Obtain contact-source, anti-spam, OAuth-provider, legal, security, and privacy approval before any outreach send. | Ready | Legal/privacy counsel; security/privacy reviewers | Concrete sources, providers, scopes, consent UX and suppression controls | Release gate LR-D5-01; drafts may be tested synthetically but sending remains disabled. |

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
- [ ] Provider failure, duplicate, bounce, complaint, disconnect, revocation, and deletion tests pass.
- [ ] Legal, security, privacy, accessibility, and product acceptance evidence is complete.

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
