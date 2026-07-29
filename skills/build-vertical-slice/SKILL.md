---
name: build-vertical-slice
description: Implement a product capability end to end through the appropriate client, generated API contract, gateway, owned domain or persistence module, transactional outbox, Temporal workflow or isolated worker, observability, and tests. Use when adding or modifying a user-facing feature, authenticated workflow, durable operation, profile behavior, application pipeline step, notification, UGC flow, or other cross-layer platform capability.
---

# Build a Vertical Slice

## Establish the slice

Read the applicable architecture section, accepted ADRs, security documents, delivery phase, and
README for each touched boundary. Inspect existing implementations before choosing patterns.
Use `guard-product-architecture` when the capability changes product, trust, or data boundaries.
Use `evolve-platform-contracts` for every shared shape or migration change.

Write the path before coding:

```text
client → gateway → owning module/transaction → outbox → workflow/activity → operation result
```

Omit layers that add no value. A folder boundary does not require a new deployment.

## Implement in order

1. Define acceptance criteria, failure cases, ownership, scopes, and data classification.
2. Change versioned contracts and generate types.
3. Implement pure invariants before framework wiring.
4. Add explicit migrations and an owner-scoped repository when persistence is required.
5. Keep state mutation, operation creation, outbox publication, audit recording, and idempotency
   atomic when they describe one accepted request.
6. Make gateway input strict, authorization scoped, resource ownership enforced, and errors
   stable.
7. Return durable operation identifiers for long-running work instead of holding HTTP requests.
8. Use deterministic Temporal workflows; put network, database, AI, and browser I/O in retryable
   activities/workers.
9. Correlate request, event, workflow, and operation IDs without logging sensitive payloads.
10. Use generated client shapes in frontends and keep mobile limitations explicit.

For external actions, define timeout, retry, duplicate prevention, cancellation, human takeover,
confirmation, and provider-isolation behavior.

## Test by risk

- Unit-test invariants and policy.
- Test valid and invalid contracts plus authorization.
- Test idempotent replay and conflicting idempotency payloads.
- Test resource ownership and redaction.
- Run a real PostgreSQL integration for transactional behavior.
- Add workflow replay/failure tests for durable multi-step behavior.
- Add client behavior tests for changed and failed operation states.
- Run `.\scripts\verify-phase0.ps1` before handoff until a later repository-wide verifier
  supersedes it.

Do not substitute mocks for the only evidence of persistence, migration, or provider behavior.

## Finish honestly

Update relevant documentation and use `govern-delivery` for tracker evidence. Mark only what the
tests or deployed evidence prove. List external gates separately from completed repository work.
