# D0-016 staging workflow release-rollback operator evidence

- Date: 2026-08-04
- Environment: Development and isolated synthetic staging source boundary
- Status: Source complete and locally verified; no artifact, plan, invocation, or AWS mutation

## Maintained implementation

The proven development workflow release-rollback coordinator is now one environment-aware
operator for exactly `development` or `staging`. Thin compatibility wrappers fix the selected
environment and default IAM Identity Center profile. The shared implementation derives the
environment Terraform directory, ignored recovery directory, context schema, state backend,
strict workflow-dark planner, and every result field from that selection.

Planning requires clean `main` at its exact configured upstream commit, the selected temporary
account caller, two retained reviewed Terraform plans below that environment's `.terraform`
directory, and two distinct accepted workflow artifact sources. The retained plans must agree on
the gateway artifact and both pinned extension layers, preventing a workflow rollback from
silently changing the API release or runtime layer.

The coordinator delegates all release semantics to the existing environment-aware strict planner.
Each direction therefore requires healthy immutable aliases, bounded concurrency, disabled
replacement triggers, an empty durable DLQ, seven healthy alarms, a complete durable stack, idle
retained ECS services, unchanged API routing, continued Temporal dispatch, and refresh-backed zero
drift. Rollback and restoration produce different ignored saved plans and require independent
SHA-256 authorization. Cleanup is blocked until restored-release conformance is explicitly
accepted and makes no AWS change.

## Local verification

- the shared operator and both wrappers parse without error;
- development and staging wrappers expose identical parameter surfaces;
- both help and status paths pass without AWS access or retained context;
- status fixes the exact selected environment and reports no local recovery artifacts;
- an attempted staging `PlanRollback` from the intentionally dirty worktree fails on exact
  upstream provenance before AWS access;
- the infrastructure policy validator enforces environment-derived paths/schema/profile, the
  shared strict planner, disabled-trigger/no-traffic/no-ECS-capacity context values, absence of
  development-only resource names, and both wrapper/profile bindings; and
- the shared and environment-specific runbooks preserve separate plan, apply, conformance,
  notification, restoration, and cleanup gates.

No workflow artifact was built or published, no Terraform plan or context was created, no Lambda
was invoked, and no AWS, API, trigger, alarm, DLQ, ECS, Temporal, product, identity, or candidate
data changed.

## Staging prerequisite and next gate

Staging has one accepted workflow release, so rollback cannot begin yet. After this source merges:

1. publish and independently verify a second behavior-neutral workflow release from exact merged
   `main` through the protected staging artifact boundary;
2. generate, review, and separately authorize the strict release plan;
3. apply only that plan, prove zero drift, and accept full dark conformance plus all four alert
   notifications for the second release;
4. retain that accepted release plan and the accepted initial staging release plan as the two
   exact rollback endpoints; and
5. use the staging wrapper to generate separate rollback and restoration checksums, applying and
   conforming each direction only after its own explicit authorization.

This evidence does not authorize publication, deployment, rollback, restoration, cutover,
Temporal retirement, or obsolete-resource removal.
