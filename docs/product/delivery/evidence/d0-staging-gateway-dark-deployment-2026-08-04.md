# D0-016 staging gateway dark deployment evidence

- Date: 2026-08-04
- Environment: Isolated synthetic staging AWS account in `us-east-2`
- Planner source commit: `23126b7b03fcd5631e23a2ea2f7f73695abf9c8b`
- Artifact source commit: `a68f36d5f55521c0221df38d9d1d4c375d88824d`
- Applied-plan SHA-256: `3ad42ca7835610a689b1cff36ff84fecc7bce09cded3f944e7dcd778901c22bd`
- Post-apply verification-plan SHA-256: `12ef20a1e723b31afc17fcdf57893a576c558595df447f2c7cf180553d67b987`
- Authorization: Product owner supplied the exact environment, plan purpose, and checksum
- Status: Dark gateway infrastructure deployed and zero drift; traffic and workflow cutover remain open

## Reviewed plan and apply

The environment-aware planner reconstructed the encrypted staging state and exact live inputs from
clean, upstream-matched `main`. The effective regional Lambda concurrency quota was `1000`, above
the guarded minimum of `102`. It independently verified the immutable gateway ZIP's source,
digest, full-object checksum, versioning, customer-managed KMS encryption, and absence of a delete
marker without disclosing storage identifiers.

The refresh-backed plan contained exactly eleven creates and no update, delete, or replacement:

| Action | Count |
|---|---:|
| Create | 11 |
| Update in place | 0 |
| Delete | 0 |
| Replace | 0 |

The creates were the gateway JWT authorizer; Lambda execution role and policy; private Secrets
Manager endpoint security group and interface endpoint; versioned gateway function, immutable
environment alias, exact-stage invocation permission; and three function-scoped alarms. There was
no API integration, route, workflow trigger, event-source mapping, ECS-capacity, data-resource, or
traffic action.

The secondary semantic audit also accounted for three non-sensitive Terraform output additions and
43 provider-refresh state normalizations. Those refresh records were not cloud actions and did not
change the reviewed action boundary. AWS IAM Access Analyzer reported zero errors and zero security
warnings for the resulting policies.

The exact authorized saved plan completed:

```text
Resources: 11 added, 0 changed, 0 destroyed.
```

An initial local pre-apply inspection rejected its own PowerShell count expression before invoking
Terraform. The saved-plan checksum and action inventory were revalidated unchanged before the
authorized apply proceeded.

## Live dark-boundary verification

Read-only AWS inspection and synthetic direct-alias probes established:

- the Node.js 24 gateway function is `Active` with a successful last update;
- the `staging` alias targets one immutable, unweighted numeric version;
- reserved concurrency is exactly `2`;
- the function uses the reviewed private VPC/database-secret path, customer-managed KMS key,
  structured logs, and active tracing;
- readiness returned HTTP `200`, proving managed-secret retrieval and PostgreSQL readiness;
- an invocation without validated authorizer context returned HTTP `401` with the sanitized
  `authentication_required` problem and `Cache-Control: no-store`;
- the three gateway alarms are enabled, exact-function-scoped, and `OK`, with one configured
  `ALARM` and one `OK` notification destination each;
- API Gateway has zero Lambda integrations and no route using the new JWT authorizer;
- the one retained integration remains the existing service-discovery HTTP proxy;
- Lambda has zero event-source mappings; and
- retained gateway and workflow-worker ECS services remain idle with zero running tasks.

Fifteen recent application-log events were inspected in aggregate and contained none of the
forbidden token, secret, email, resume, preference-body, sensitive-answer, or raw-provider
patterns. No candidate record, identifier, request body, response body, credential, endpoint,
account number, bucket, object key/version, role ARN, or key identifier is retained here.

## Post-apply state

The completed-dark verification mode accounted for all eleven resources and produced a fresh
refresh-backed plan with zero creates, updates, deletes, or replacements. The original authorized
plan was consumed and is not reusable.

This is dark infrastructure acceptance only. No staging request is routed to Lambda, no workflow
dispatch changed, no replacement trigger is enabled, and no old rollback resource was retired.

## Next gates

Before staging gateway cutover, complete the authenticated identity and two-account isolation
matrix, alarm transition and notification drill, accepted second-version release and alias
rollback/restoration, and another zero-drift check. Deploy and accept the staging workflow dark
resources with every trigger disabled before any coordinated routing change.
