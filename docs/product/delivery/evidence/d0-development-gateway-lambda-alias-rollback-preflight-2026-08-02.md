# D0-016 Development Gateway Lambda Alias Rollback Preflight — 2026-08-02

- Environment: development
- Region: `us-east-2`
- Scope: repository operator plus read-only live preflight
- AWS mutation: none
- Public runtime: unchanged ECS gateway
- Result: ready for merge and exact-main replan; not authorized for execution

## Operator boundary

`scripts/operate-development-gateway-lambda-alias-rollback.ps1` implements a checksum-gated dark
alias drill with three explicit actions: read-only plan, reviewed execution, and guarded local
cleanup. It fixes the development function and alias names, requires the temporary IAM Identity
Center caller, and restricts the region to `us-east-2`.

The plan verifies:

- stable ECS services remain the public API route;
- the dark function is healthy with reserved concurrency `2`;
- the alias is unweighted and points to one immutable current version;
- the current and rollback versions are active Node.js 24/x86_64 releases;
- role, KMS, VPC, layer, tracing, resource, and non-release environment configuration match;
- the tracked function artifact matches the current alias; and
- the rollback target is version `2` or newer, structurally excluding the known-defective version
  `1`.

Execution requires both `-Execute` and the reviewed context SHA-256. It uses the captured alias
revision ID for optimistic locking, transitions only to the reviewed rollback version, requires
the guarded bridge to return `200/200/401`, and restores the original version in `finally` using
the revision created by the drill. It repeats bridge and full preflight checks after restoration.
The operator never changes the Lambda function, Terraform, API integration/routes, ECS, RDS, IAM,
KMS, VPC, queues, secrets, alarms, or public traffic.

## Read-only live result

The deployed preflight passed AWS/Terraform/Auth0 alignment, dark alias/JWT-authorizer health,
stable ECS services, and unchanged public routing. The sanitized plan selected:

| Field | Result |
|---|---:|
| Current immutable version | `3` |
| Accepted rollback version | `2` |
| Alias updates on execution | `2` |
| Public traffic changes | `0` |
| Preflight context SHA-256 | `a8eb5b15f019205080c2f4377984a9957101ea41b0b527bbcffc224dfdf65216` |

Missing `-Execute`, a wrong checksum, version `1`, and plan overwrite were each rejected before
mutation. The live alias remained on version `3`. The ignored preflight context was then removed
through its exact checksum and guarded cleanup action.

## Remaining authorization gate

This evidence does not authorize alias mutation. Merge the operator and runbook, synchronize exact
`main`, regenerate the read-only context, and review the new checksum. Only an explicit approval of
that exact regenerated plan may execute the `3 → 2 → 3` drill. Afterward require current-version
bridge/preflight, completed-dark zero drift, healthy alarms, clean privacy-safe error aggregates,
and context cleanup before recording rollback readiness.

## Subsequent outcome

The separately reviewed exact-main execution and all post-restore gates subsequently passed. See
the [completed rollback evidence](d0-development-gateway-lambda-alias-rollback-2026-08-02.md).
