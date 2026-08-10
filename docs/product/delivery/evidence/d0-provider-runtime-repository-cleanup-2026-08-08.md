# D0 provider/runtime repository cleanup — 2026-08-08

## Scope

After both AWS environments completed the fail-closed legacy-dispatch migration, provider-key
revocation, legacy image purge, and Terraform-owned resource cleanup, the maintained repository was
reduced to the accepted steady-state implementation. Historical delivery evidence and the
append-only migrations remain as records; they are not executable fallback paths.

## Removed implementation

- Removed the gateway dark-conformance bridge and its tests.
- Removed the Temporal retirement client/probe and the Temporal SDK/package commands.
- Removed gateway/worker image definitions and all dark, cutover, legacy-drain, rollback, provider-
  retirement, and continuous-ECS operators that could reintroduce the retired runtime.
- Removed superseded deployment/provider/Temporal runbooks and replaced them with steady-state
  serverless application release, one-off database migration, Auth0 recovery, tracing, workload,
  restore, and alert guidance.
- Removed dark/cutover browser modes. Deployed conformance now accepts only the selected
  environment's immutable Lambda alias, exact Auth0 JWT authorizer, Lambda durable dispatch,
  enabled triggers, empty ECS application inventory, and `200/200/401` boundary.

The infrastructure validator explicitly rejects the removed paths and dependencies. The only
retained Fargate definition is the hardened, digest-pinned, one-off database migration task.

## Verification

- all PowerShell scripts parse;
- repository skills validate;
- the serverless infrastructure policy passes;
- web tests pass `34/34` and type checking passes;
- gateway tests pass `36/36` and type checking passes;
- workflow tests pass `19/19` and type checking passes;
- the full Phase 0 gate passes contract generation, formatting, lint, every workspace type check,
  every workspace test, every production build, Compose validation, and removed-scope checks;
- dependency audit passes with only the two existing exact, expiring mobile-build exceptions;
- bootstrap, development, and staging Terraform configurations validate, and all four platform
  module tests pass with a pinned test-root provider lock;
- the read-only staging launcher passes exact Auth0 issuer/audience, immutable alias, bounded
  concurrency, enabled triggers, empty ECS, and public `200/200/401` checks; and
- the rewritten staging workload/cost inspector independently reconstructs accepted applied inputs
  without a retired operator and reports fresh zero drift, `lambda_durable`, enabled triggers, and
  empty ECS. Its 2026-08-08 read observed an estimated `$10.4745` month-to-date staging cost, one
  budget, and one CUR 2.0 export; final two-account cost reconciliation remains open.

The product owner separately confirmed post-retirement preference save/persistence, readiness
success, and sanitized cross-user denial. Repository cleanup and SR-009 are accepted; this is not
legal/privacy approval, independent security approval, or final cost acceptance.
