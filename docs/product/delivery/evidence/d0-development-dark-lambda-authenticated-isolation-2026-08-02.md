# D0-016 Development Dark Lambda Authenticated Isolation — 2026-08-02

- Environment: development
- Region: `us-east-2`
- Runtime under test: unrouted gateway Lambda alias
- Public runtime during test: existing ECS gateway
- Data boundary: synthetic development accounts and records only
- Result: passed

## Outcome

The corrected development gateway Lambda passed authenticated preference persistence and
cross-user operation isolation through the real web/BFF conformance path. The Lambda remains dark:
the public API integration still targets ECS, and no Fargate, VPC Link, Cloud Map, worker, database,
queue, backup, or persistent-data resource was retired or rerouted.

This closes SR-002 for the versioned API Lambda boundary and JWT-authorizer contract. It does not
complete D0-016, authorize a route cutover, or prove the still-unimplemented SQS/durable-workflow
replacement.

## Identity propagation correction

The first authenticated browser attempt reached the real Nest route but returned `401` with
`Validated API Gateway identity context is required`. Sanitized Lambda request evidence proved API
Gateway authorizer claims had already passed the outer boundary; the principal was lost when
`AsyncLocalStorage` crossed Fastify's real injection lifecycle.

[PR #74](https://github.com/Vrixic/project-ai-job-apply/pull/74) replaced that fragile propagation
with a concurrency-safe invocation capability:

- the outer handler accepts only the exact validated issuer, audience, and subject context;
- the caller's bearer token is overwritten before application injection;
- a random 256-bit internal capability maps to one principal only in Lambda memory;
- concurrent invocations use independent capabilities;
- every capability is deleted in `finally`, including failed dispatches; and
- unknown, missing, expired, or out-of-dispatch capabilities fail closed.

A real Nest/Fastify regression test now covers the lifecycle that the earlier mocked injection test
missed. Unit coverage also proves issuer/audience/subject denial, internal-token replacement,
concurrent-principal isolation, and post-dispatch cleanup.

## Immutable release and exact apply

The merged source was published by
[workflow run 30732522960](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30732522960).
The publisher passed gateway tests and the High-severity dependency audit, built the artifact twice
with the same publisher checksum, generated a CycloneDX SBOM, assumed the environment GitHub OIDC
role, and wrote one immutable version to the private versioned KMS-encrypted artifact bucket.

[PR #75](https://github.com/Vrixic/project-ai-job-apply/pull/75) added a subsequent-release guard to
the existing dark planner. It verifies the healthy current function, immutable alias, pinned
official extension layer, bounded concurrency, exact publisher-owned object version/checksum,
stable ECS rollback services, encrypted state, and unchanged API integration. It rejects any plan
outside the function artifact/version and alias transition.

The reviewed refresh-backed plan contained:

| Action | Count |
|---|---:|
| Create | 0 |
| Update | 2 |
| Delete | 0 |
| Replace | 0 |
| API traffic change | 0 |

The two updates were the gateway Lambda artifact/version and the `development` alias transition to
the new immutable version. The checksum-matched saved plan applied successfully. Completed-dark
verification then accounted for all 11 reviewed resources with zero creates, updates, deletes, or
replacements; reserved concurrency remained `2`, ECS rollback services remained stable, and API
traffic remained unchanged.

## Deployed conformance

The automated dark preflight proved development AWS/Terraform/Auth0 alignment, the active Lambda
and immutable alias, the dormant exact JWT authorizer, unchanged ECS route, managed-secret/database
readiness, and the expected `200/200/401` bridge boundary.

The product owner then completed the browser-based two-account isolation sequence:

1. Account A authenticated through the real Auth0 web flow, saved synthetic preferences through the
   dark Lambda, and obtained its owned operation.
2. Account B authenticated independently and attempted to read Account A's operation identifier.
3. The owner-scoped API returned the existing non-disclosing response, and the conformance control
   reported: `Cross-user isolation passed: this account could not read the first account's
   operation.`

No token, provider subject, email, preference body, operation identifier, or raw log is retained in
this evidence.

## Remaining gates

- Exercise dark-Lambda alarm delivery and a controlled alias rollback/recovery.
- Complete the remaining malformed/oversized/method/scope and cold-start/secret-rotation failure
  matrix where existing evidence is not yet equivalent.
- Implement SR-003 and SR-004: SQS/outbox recovery and versioned Lambda durable workflows.
- Deploy and accept the replacement in isolated synthetic staging before any development cutover.
- Cut over only through a separate reviewed plan with rollback, then retire every obsolete
  always-on runtime resource and reconcile post-cutover cost.
