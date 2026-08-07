# Staging restoration and gateway-capacity correction evidence

Date: 2026-08-06
Delivery: D0-016 / SR-005 / SR-006
Environment: isolated synthetic staging in `us-east-2`

## Evidence boundary

The separately reviewed restoration plan was applied from exact merged source. It restored the
Lambda API integration, public health routes, JWT-protected default route, durable dispatch, and
three workflow triggers without resuming ECS. Refresh-backed verification reported zero drift,
the cutover-aware deployed validator passed the Lambda/JWT/trigger/idle-ECS boundary, and public
smoke returned `200/200/401`.

This record does not accept the restored runtime. The fixed public workload failed and therefore
stopped before the workflow portion could establish full post-restoration acceptance.

## Failure reproduced

The fixed workload runs five public requests concurrently. A separate aggregate-only replay of the
same 500-request public profile reproduced the failure:

| Probe | Expected | Passed | Failed | Failure class |
|---|---:|---:|---:|---|
| `GET /health/live` | `200` | 179 | 21 | `503` |
| `GET /health/ready` | `200` | 181 | 19 | `503` |
| unauthenticated `GET /v1/me` | `401` | 100 | 0 | none |

There were no client/network failures. The gateway function is active with reserved concurrency
`2`, while the accepted workload deliberately uses concurrency `5`. API Gateway surfaced the
resulting invocation throttles as `503`. The complete unauthorized sample still returned the
expected `401`, so this is a capacity-boundary defect rather than an authentication, authorization,
or connectivity defect.

## Connection-budget decision

The gateway Lambda creates at most two PostgreSQL connections per warm execution environment.
Raising staging reserved concurrency from `2` to `5` therefore bounds gateway pool capacity at ten
connections. The staging database is an available private `db.t4g.micro` using PostgreSQL 16's
default `max_connections` formula; CloudWatch observed a maximum of five database connections
during the failed run. Existing workflow/database functions remain independently capped. This is
inside the already encoded Terraform validation range of one through five and does not require RDS
Proxy or provisioned concurrency.

Reducing the workload concurrency was rejected because it would hide a real runtime mismatch and
invalidate comparison with the previously accepted fixed workload. The source correction instead:

- sets only staging's desired gateway reserved concurrency to `5`;
- leaves development at its already proven concurrency `2` boundary;
- adds a strict one-update staging plan mode that permits only
  `aws_lambda_function.gateway.reserved_concurrent_executions` from `2` to `5`;
- requires an exact saved-plan checksum before apply and performs completed-runtime zero-drift
  verification afterward;
- adds a no-AWS-mutation restoration-context continuation that reproves the accepted corrected
  runtime and empty-work boundary before rebinding cleanup to a current-source baseline;
- keeps the JWT authorizer/routes, immutable function version and alias, workflow triggers,
  artifacts, data, and idle ECS unchanged; and
- makes deployed conformance enforce the environment-specific reviewed ceiling.

## Planner preflight correction

The first post-merge planning attempt failed before producing a capacity plan or changing AWS. The
new maintenance mode had not been excluded from the gateway-only initial-deployment baseline. That
baseline therefore modeled removal of already accepted serverless workflow resources and correctly
failed its strict boundary. The correction replaces the duplicated maintenance-mode exclusions
with the planner's shared `runtimeCutoverActive` predicate and adds a source-policy assertion for
that exact placement. This changes only preflight selection; it does not broaden the capacity
plan's one-resource, one-property boundary.

## Verification and remaining gate

Repository verification must pass before publication. No AWS resource has been changed by the
capacity correction yet. After merge, generate the exact staging capacity plan, review and apply
only its checksum, confirm zero drift and reserved concurrency `5`, then rerun:

1. the 500-request public profile with zero failures;
2. the authenticated 25-workflow/idempotent-replay profile;
3. the real two-account non-disclosing isolation check; and
4. aggregate Lambda/API/database/queue/DLQ/alarm/privacy corroboration.

Only those results can complete restored staging acceptance.
