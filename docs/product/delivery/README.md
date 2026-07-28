# Delivery Tracking

This folder turns the architecture roadmap into an auditable delivery system.

## Contents

- `DELIVERY_TRACKER.md` — Master status, start, completion, dependency, exit gate, and task-document links.
- `phase-0-foundation.md` — Product, data, legal, security, and engineering foundation.
- `phase-1-web-and-job-catalog.md` — Useful candidate web product and canonical job catalog.
- `phase-2-extension-and-community.md` — Browser extension and UGC job contribution loop.
- `phase-3-application-preparation.md` — Grounded documents, application packets, and supported ATS autofill.
- `phase-4-workday-and-remote.md` — Workday behavior and isolated remote preparation.
- `phase-5-outreach-and-notifications.md` — Personalized outreach and application notifications.
- `phase-6-mobile-and-paid.md` — Mobile companion and Free/Pro paid launch.
- `phase-7-quality-and-expansion.md` — Application-quality optimization, new ATS/regions, and optional employer product.

## Tracking rules

1. A delivery starts when its first task moves to `In progress`; record the actual ISO date.
2. A delivery completes only when every exit criterion has evidence and unresolved blockers are closed or explicitly accepted.
3. Predicted dates are not required. Scope is reduced before quality, safety, robustness, or maintainability.
4. Task documents are living records. Add newly discovered work to the task register and append meaningful activity to the work log.
5. Never erase important changes in direction. Record them in the decisions/change log.
6. Evidence should link to code, tests, ADRs, product documents, dashboards, releases, or review records.
7. The master tracker and phase document must be updated together when status, start, or completion changes.

## Status vocabulary

- `Not started`
- `In progress`
- `Blocked`
- `Paused`
- `Complete`

Individual tasks may additionally use `Ready` and `Removed`. A removed task requires a recorded reason.
