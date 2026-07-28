# D0 — Product, Data, and Legal Foundation

- Status: In progress
- Start: 2026-07-27
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-07-28
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d0--product-data-and-legal-foundation)

## Objective

Establish the reviewed product boundaries, canonical data/contracts, legal and privacy posture, security model, engineering foundation, and quality baselines required for every later delivery.

## Task register

Add tasks as work is discovered. Do not mark a task complete without linked evidence.

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D0-001 | Choose launch geography, initial candidate segment, and product name. | Ready | Unassigned | Product decision | Open |
| D0-002 | Conduct research sessions with representative job seekers and map at least 20 recent real application journeys. | Ready | Unassigned | D0-001 segment | Open |
| D0-003 | Validate source/API terms, UGC contribution license, takedowns, application authorization, and outreach constraints. | Ready | Unassigned | Legal counsel | Open |
| D0-004 | Define versioned truth-profile, canonical-job, field-ontology, event, application-packet, and consent schemas. | In progress | Unassigned | Architecture | Initial concepts exist in the architecture; formal contracts remain open. |
| D0-005 | Produce threat models, data-flow/classification map, subprocessor map, and retention/deletion specification. | Ready | Unassigned | D0-004 | Initial controls exist in the architecture; formal documents remain open. |
| D0-006 | Establish the monorepo, ADR process, dependency workspace, CI, environments, secrets pattern, and baseline observability. | In progress | Unassigned | Repository access | Responsibility folders and READMEs are scaffolded; runtime/tooling remains open. |
| D0-007 | Establish the permitted ATS fixture acquisition and sanitization process. | Ready | Unassigned | D0-003, D0-005 | Open |
| D0-008 | Define baseline application quality, reliability, safety, efficiency, and operating-cost measurements. | Ready | Unassigned | D0-002, D0-004 | Open |
| D0-009 | Create and maintain the master delivery tracker and phase task records. | Complete | Unassigned | Architecture roadmap | `DELIVERY_TRACKER.md` and phase documents |

## Exit criteria

- [ ] Launch segment, geography, and product positioning are explicitly approved.
- [ ] Source, contribution, application automation, outreach, privacy, and mobile-store assumptions have accountable legal review.
- [ ] Core schemas and ownership boundaries are versioned and pass compatibility review.
- [ ] Threat model, data map, consent model, retention, export, and deletion designs are approved.
- [ ] Repository workspace, CI, development/staging environments, secrets, observability, and ADR workflow operate end to end.
- [ ] Sanitized ATS fixture policy and initial representative fixtures are available.
- [ ] Quality and reliability baselines have definitions, owners, and reproducible measurement.
- [ ] A thin authenticated vertical slice proves client → gateway → durable state → worker → observable result.
- [ ] Product requirements explicitly prohibit coaching, inbox/calendar reading, and tracking post-submission hiring outcomes.

## Work log

Append meaningful activity; do not replace prior entries.

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-07-27 | Initial product and system architecture created from researched product/ATS/platform constraints. | D0-004, D0-005, D0-006 | [Architecture](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md) |
| 2026-07-28 | Responsibility-based repository folder structure and per-folder documentation created. | D0-006 | [Repository root](../../../README.md) |
| 2026-07-28 | Master delivery tracker and living task documents created. | D0-009 | [Delivery tracker](DELIVERY_TRACKER.md) |
| 2026-07-28 | Product boundary updated to exclude coaching and all post-submission hiring-outcome collection. | D0-004, D0-005, D0-008 | [Architecture](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-07-28 | D0 is marked in progress from 2026-07-27. | The architecture artifact represents actual foundation work. | Architecture document history |
| 2026-07-28 | Application tracking ends at confirmed submission; the application agent is not a coach. | Keep the product focused on fast, tailored application execution. | Updated architecture and delivery records |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D0-R1 | Open | Launch segment/geography is unresolved and affects data, taxonomy, legal, and onboarding decisions. | Unassigned | Make D0-001 the first product decision. |
| D0-R2 | Open | Legal review is required before source ingestion or automated submission implementation. | Unassigned | Identify counsel and create a source-by-source review register. |
| D0-R3 | Open | No dependency workspace, CI, runtime, or environment exists yet. | Unassigned | Record ADRs, then initialize the smallest production-shaped vertical slice. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
