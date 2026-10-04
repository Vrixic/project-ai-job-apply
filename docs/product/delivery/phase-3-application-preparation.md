# D3 — High-Quality Application Preparation

- Status: In progress
- Start: 2026-09-18
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-10-04
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d3--high-quality-application-preparation)

## Objective

Deliver fact-grounded, review-by-exception application preparation, measured assisted submission,
and authoritative owner-scoped technical history through confirmed submission for supported ATS
platforms.

## Definition of done (added 2026-09-19)

The Phase 3 exit sentence is the test: a candidate can prepare, skim, approve, submit, confirm, and review technical history on a supported ATS site. A task is **done** only when its part of that journey works through the deployed web app and the installed extension for a person, and the evidence names the journey step. Library tests, API-level synthetic acceptance, and screens that stop before the next step are recorded as **layer evidence** and never as done. Before asking the owner to try something, state plainly what it does and does not do yet.

## Deployment posture

Keep document and AI work on bounded queues/workers with concurrency limits inside the lean
runtime. Add dedicated AI/rendering capacity only from queue, latency, isolation, or model-provider
evidence; durable workflow, factuality, and approval controls are never scaled down.

## Task register

2026-10-03 source-only checkpoint: D3-044 adds original gateway non-dispatch receipts and a
matching private cleanup operation. Local suites pass 111 AI SDK, 660 Documents unit and 106
opt-in PostgreSQL ledger cases; full maintained verification passes. No deployment
or phase-exit acceptance is claimed.

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| 2026-10-04 | D3-063 source/local verification passes: 283 AI SDK units, 1,014 Documents units and all 275 PostgreSQL cases across seven files; full maintained verifier passes 38 typecheck tasks, 39 test tasks and 23 builds with unchanged generated contracts/formatting/baseline lint and operational/security/Compose/scope checks. Metadata-only original terminal receipt and separate private v1 action atomically fence future work and settle only the exact captured provider grant. Other running writers remain pending. Provider HTTP/Lambda/managed secret/authentication are simulated. Tmpfs fixture removed; Docker Desktop/WSL stopped. Four private artifacts build from clean c5a561e; independent integrity and actual bundled terminal default-off refusal pass with zero fetch calls. Artifacts unpublished. Hosted CI/CD deferred by owner; no deployment/activation or phase completion. | D3-063 | [Evidence](evidence/d3-original-background-terminal-drain-2026-10-04.md) |
