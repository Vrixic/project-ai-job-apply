# D0-016 SR-005 development workflow dark-plan evidence

- Date: 2026-08-02
- Environment: Development AWS account in `us-east-2`
- Terraform source commit: `1e97b771cb955b9665ed5f8d96d3d1fa127e8a9c`
- Terraform version: `1.9.8`
- Diagnostic plan SHA-256: `85a7920ad51be43cb6ba5d97d8720626b83bf244e0b22e860b7fc11c611916ea`
- Status: Guarded diagnostic passed; sensitive plan is local, ignored, and unapplied

## Reconstructed inputs

The operator first ran the existing dark-gateway preflight against the exact live ECS services,
task definitions, PostgreSQL configuration, Auth0 audience/issuer, Temporal endpoint/namespace,
gateway artifact, pinned regional Secrets extension, Lambda concurrency, API route, and encrypted
Terraform state.

The merged workflow source changes the existing Secrets Manager endpoint policy statement name
from its gateway-only wording to the generalized exact-Lambda-role wording. The gateway preflight
therefore reported one expected update rather than literal zero source delta. The new operator
accepted only that SID-only transition after normalizing the statement name and proving every
action, resource, principal, and condition remained identical. It rejects any other baseline
change. ECS services were stable and public API traffic remained on the accepted ECS integration.

The operator independently read back all three exact workflow ZIP object versions and verified
their full-object SHA-256, source/digest metadata, KMS encryption, and bucket keys. It also verified
the pinned official x86_64 Secrets extension and enough account concurrency to preserve the
standard unreserved pool after all reviewed reservations.

## Exact diagnostic result

| Action | Count |
|---|---:|
| Create | 37 |
| Update in place | 5 |
| Delete | 0 |
| Replace | 0 |

The 37 creates are the complete dark workflow boundary:

- two disabled EventBridge rules and their targets;
- one disabled partial-batch SQS event-source mapping;
- seven workflow/durable/activity/DLQ alarms;
- five bounded workload roles and five inline policies;
- four ordinary Lambda functions, four immutable aliases, and two exact EventBridge permissions;
- one Terraform-owned CloudFormation stack containing the versioned, CMK-encrypted durable
  function and alias;
- one encrypted profile-readiness DLQ and its exact-source queue policy; and
- private Lambda and SQS interface endpoints.

The five in-place updates are limited to:

1. adding the existing event queue send permission to the dark gateway role;
2. extending the platform KMS policy to the exact new workload roles;
3. adding `OUTBOX_DISPATCH_TARGET=temporal` and the existing queue URL to the dark gateway Lambda,
   which produces a new immutable version;
4. moving only the still-unrouted development gateway alias to that version; and
5. extending the private Secrets Manager endpoint policy to the exact database-using Lambda roles.

Role-dependent IAM/KMS/endpoint documents remain unknown values inside Terraform until the new
roles exist. The plan guard therefore allows only each resource's `policy` field to be unknown and
uses the repository infrastructure policy validator to enforce the source documents. No other
field on those existing resources may change.

## Dark-boundary checks

The saved plan passed all of these checks:

- gateway dispatch remains exactly `temporal`;
- the SQS starter event-source mapping is created disabled and retains partial-batch reporting;
- the outbox reconciler and durable terminal EventBridge rules are created `DISABLED`;
- no API Gateway API, integration, route, or stage changes;
- no ECS cluster, service, task definition, capacity, or image changes;
- no create/delete/replacement outside the exact resource allowlist;
- each ordinary Lambda selects the exact artifact object version/checksum, pinned layer, and
  reserved concurrency of one;
- the durable stack selects the exact durable artifact/version with reserved concurrency of two;
- no resource deletion or replacement; and
- no state, data, workflow, route, trigger, or traffic mutation because the plan was not applied.

No account number, bucket name, KMS identifier, role ARN, credential, token, OIDC value, Temporal
value, policy body, state content, plan content, or candidate data is retained in this record.

## Next gate

Merge the guarded operator and evidence, synchronize exact `main`, then regenerate this plan. A
changed post-merge checksum requires a new exact authorization. Applying the dark plan remains a
separate gate and must be followed by live trigger-disabled, function health, alarm, policy,
artifact, ECS/API/Temporal stability, and refresh-backed zero-drift proof.
