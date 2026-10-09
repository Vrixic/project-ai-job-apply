---
name: govern-delivery
description: Maintain the platform's evidence-gated delivery system. Use when starting or completing a phase, adding or updating tasks, recording work, decisions, risks, blockers, evidence, actual dates, exit criteria, or synchronizing a phase document with the master DELIVERY_TRACKER.md after implementation or review.
---

# Govern Delivery

## Load the records

Read:

- `../../docs/product/delivery/README.md`
- `../../docs/product/delivery/DELIVERY_TRACKER.md`
- the affected `../../docs/product/delivery/phase-*.md`
- linked evidence and the architecture delivery roadmap

Do not rely on a prior summary when evidence can be inspected directly.

## Apply status rules

- Record actual ISO dates, not estimates.
- Start a delivery when its first task actually enters `In progress`.
- Use only the documented status vocabulary.
- Add discovered work to the task register; never hide it to make a phase appear complete.
- Append meaningful work-log and decision entries; preserve history.
- Link evidence to code, tests, reviews, deployment artifacts, dashboards, or records.
- Update the phase document and master tracker together when status, start, or completion changes.
- Keep external approvals and unavailable credentials as explicit blockers.
- Never turn technical implementation into legal, privacy, research, or production approval.

## Record implementation

1. Inspect the changed artifact and its validation output.
2. Update task state only to the level proven.
3. Add a concise append-only work-log entry with linked evidence.
4. Add or update risks/blockers and the concrete next action.
5. Update exit-criterion checkboxes only when the criterion's entire wording is evidenced.
6. Synchronize master summary/status if it changed.
7. Validate local Markdown links.

Local verification can complete repository implementation tasks while the overall phase remains in
progress behind deployed or external gates.

When a batch of tasks is implemented before its tests (see `build-vertical-slice`), record each
task's evidence as implementation complete with tests deferred to the batch verification pass;
do not mark a task's testing state proven until that pass actually runs. Infrastructure and AWS
changes keep their per-change verification evidence as usual.

## Complete a delivery

A delivery is complete only when:

- Every exit criterion has linked, inspected evidence.
- Every required task is complete or formally removed with a recorded reason.
- Blockers are closed or explicitly accepted by an accountable owner.
- Required deployed, restore, security, privacy, legal, research, and quality evidence exists.
- The completion date and completion record are written in the phase document.
- The same date/status appears in the master tracker.

If any condition is absent, leave the phase non-complete and explain precisely what remains.

## Preserve roadmap priorities

In the delivery-roadmap records, prefer quality, simplicity, robustness, scalability, and
long-term maintainability over forecast development cost or timeline. Do not silently extend the
product into coaching or post-submission hiring-outcome tracking.
