# D8 - Job Source Discovery

- Status: Not started
- Start: Not started
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-11-18
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d8---job-source-discovery)

## Objective

Find out whether a third-party job-search service can tell us which companies to add to the catalog, without that service ever becoming a source of the jobs candidates see. This is the last phase and starts only when the owner asks for it.

Today the catalog holds only companies the owner approved one by one: each has an exact Greenhouse, Lever or Ashby board and an [ADR-025](../../adr/025-public-ats-feed-activation-governance.md) activation record. Finding the next company is manual. A discovery service could shorten that step. Every job shown to a candidate must keep coming from the company's own public board through our own adapters.

Origin: owner request 2026-11-18 after a review of the treg Jobs API (treg.to/jobs-api), a pay-per-call broker over providers such as Hirebase and JobsPipe. Findings are in the work log.

## Boundaries

- Discovery output is a list of company names and board identifiers kept outside the catalog. No job description, salary or other posting content from the service is stored, indexed or shown.
- No candidate data (profile, resume, answers) is ever sent to a discovery service.
- Out of scope, by the product boundary and [AGENTS.md](../../../AGENTS.md): hiring-manager and email lookup, outreach, recruiter signals, and third-party fit scoring. Our conservative matching stays our own.
- A company still enters the catalog only through the existing source-activation path (D1/D2 adapters, one activation record per company).

## Task register

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D8-001 | Read the provider's own terms (Hirebase directly, and treg's reselling and storage terms if it is used) and record exactly what may be kept: expected result is a company and board lead list only. | Ready | Unassigned | Owner starts D8 | Open |
| D8-002 | Run a small read-only trial on free credit with an account the owner creates: a few searches, then record which fields and board identifiers come back and how many are new to us. | Ready | Unassigned; owner creates the account | D8-001 | Open |
| D8-003 | Decide go or no-go on a discovery step from D8-002 and write an ADR if go. A no-go ends the phase. | Ready | Owner | D8-002 | Open |
| D8-004 | If go: a script or operator that turns discovered companies into a candidate list the owner reviews; accepted companies go through the existing ADR-025 activation. | Ready | Unassigned | D8-003 go | Optional; not assumed. |
| D8-005 | Security: any discovery call runs outside candidate-data paths, the key lives in the secret store, the host is a fixed egress allowlist entry, and nothing from the service reaches the catalog or candidate UI. | Ready | Unassigned | D8-004 | Open |

## Exit criteria

- [ ] The provider's terms are recorded and the use stays inside them.
- [ ] The trial result and the go or no-go decision are recorded; a no-go completes the phase.
- [ ] If go: discovery output is a reviewed lead list only, and every catalog job still comes from a company's own board through our adapters.
- [ ] If go: no candidate data is sent to the service, and the key, host and egress are controlled (D8-005).

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-11-18 | Phase added at the owner's request after reviewing treg. Findings: its free Greenhouse, Lever and Ashby feeds duplicate our adapters; Hirebase cross-company search is the only gap and fits only as a lead list; salary data, Jev fit scoring and people/email lookup were judged out of scope or not worth the privacy and licensing cost. Nothing was called or integrated. | D8-001 to D8-005 | [treg Jobs API](https://treg.to/jobs-api), [treg terms](https://treg.to/terms) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-11-18 | D8 is the last phase and starts only on the owner's request. | Finding companies by hand is slow but not blocking; every earlier phase comes first. | Owner request 2026-11-18 |
| 2026-11-18 | Discovery is a lead list only; catalog jobs keep coming from company boards through our adapters. | The architecture source order and ADR-025 govern what may be ingested and republished, and a broker's data terms may limit storing and redisplay. | [Architecture section 8.1](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md), [ADR-025](../../adr/025-public-ats-feed-activation-governance.md) |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D8-R1 | Open | Provider terms may forbid storing or reusing even a company list. | Unassigned | D8-001 settles this before any call is made. |
| D8-R2 | Open | A broker in early access has no uptime or support commitment. | Unassigned | Keep discovery offline and optional; nothing in the candidate path depends on it. |
| D8-R3 | Open | Scope drift into outreach, enrichment or third-party scoring. | Unassigned | Hold the boundaries above; each needs its own owner decision. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
