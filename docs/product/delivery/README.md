# Delivery Tracking

This folder turns the architecture roadmap into an auditable delivery system.

## Contents

- `DELIVERY_TRACKER.md` — Master status, start, completion, dependency, exit gate, and task-document links.
- `phase-0-foundation.md` — Product, data, legal, security, and engineering foundation.
- `phase-0-serverless-runtime-migration.md` — Living D0-016 plan for replacing the always-on
  gateway/worker runtime and retiring its obsolete resources.
- `phase-1-web-and-job-catalog.md` — Useful candidate web product and canonical job catalog.
- `phase-2-extension-and-community.md` — Browser extension and UGC job contribution loop.
- `phase-3-application-preparation.md` — Grounded documents, application packets, and supported ATS autofill.
- `phase-3-1-structured-profile.md` - Structured candidate Profile replacing profile facts; follows Phase 3.
- `phase-3-2-live-ai-generation.md` - Live AI generation (the main feature) once a provider meets the ADR-038 retention limit.
- `phase-4-workday-and-remote.md` — Workday behavior and isolated remote preparation.
- `phase-5-outreach-and-notifications.md` — Personalized outreach and application notifications.
- `phase-6-mobile-and-paid.md` — Mobile companion and Free/Pro paid launch.
- `d6-production-launch-plan.md` - Ordered route to production for the deferred Phase 2 items and the rest of D6.
- `phase-7-quality-and-expansion.md` — Application-quality optimization, new ATS/regions, and optional employer product.

## Tracking rules

1. A delivery starts when its first task moves to `In progress`; record the actual ISO date.
2. A delivery completes only when every exit criterion has evidence and unresolved blockers are closed or explicitly accepted.
3. Predicted dates are not required. Scope is reduced before quality, safety, robustness, or maintainability.
4. Task documents are living records. Add newly discovered work to the task register and append meaningful activity to the work log.
5. Never erase important changes in direction. Record them in the decisions/change log.
6. Evidence should link to code, tests, ADRs, product documents, dashboards, releases, or review records.
7. The master tracker and phase document must be updated together when status, start, or completion changes.
8. Foundational legal and security approval belongs in D0. A source, provider, permission,
   external action, jurisdiction, or other concrete capability also requires a blocking delta
   approval in the delivery that implements it.
9. Every delivery follows [ADR-016](../../adr/016-scale-to-zero-application-runtime.md): default
   APIs and durable orchestration to scale-to-zero Lambda, and use Fargate only for explicit
   on-demand container/browser workloads. Also preserve [ADR-013](../../adr/013-lean-until-demand-cloud-runtime.md)
   where it remains applicable: avoid an ALB, Redis, dedicated search, Multi-AZ data, per-AZ NAT,
   extra replicas, or always-on staging until launch review, a security/recovery requirement, or
   measured demand justifies it. Lean capacity never reduces testing, durability, privacy, safety,
   backup, or observability.
10. Public launch requires the independent exact-candidate assessment, finding treatment, retest,
    and signed disposition in [ADR-015](../../adr/015-independent-prelaunch-security-review.md).
    Phase-level design reviews, repository authorship, internal tests, and automated scanners do
    not replace this final release gate.

11. Owner decision 2026-10-21: hosted admin acceptance and every other non-security test,
    acceptance or evidence gate are removed from all incomplete phases. Security and
    legal gates (rules 8 and 10) remain. Owner decision 2026-10-22: privacy reviews and
    approvals are removed from all phases. Keep records to one short line per change.

## Status vocabulary

- `Not started`
- `In progress`
- `Blocked`
- `Paused`
- `Complete`

Individual tasks may additionally use `Ready` and `Removed`. A removed task requires a recorded reason.
