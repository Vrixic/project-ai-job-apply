# Staging Application Recovery

Use this procedure to prove two distinct recovery boundaries in the dedicated synthetic-only
staging environment in `us-east-2`:

1. ECS can replace the lean worker and gateway tasks without changing their immutable task
   definitions or losing gateway liveness.
2. Terraform can remove only the application runtime and then recreate that exact boundary while
   preserving all persistent infrastructure and migration history.

This exercise does not alter Auth0, Temporal Cloud, RDS data, KMS, S3, SQS/DLQ, ECR, Secrets
Manager containers or values, networking, remote state, or the migration task definition. Under
[ADR-014](../../../docs/adr/014-shared-development-auth0-for-synthetic-staging.md), all staging
data and identities remain synthetic and the shared development Auth0 issuer is not an
identity-isolation claim.

## Operator and interruption boundary

Use Terraform `1.9.8` and the temporary `ai-job-apply-staging-admin` IAM Identity Center profile.
Run only from a clean revision that has passed repository checks. Keep the ignored recovery
context and saved plans inside the staging `.terraform/` directory; they may contain account,
image, and provider configuration and must never enter source control or evidence.

The rolling restart uses the live ECS `100%` minimum / `200%` maximum deployment configuration.
It starts the replacement before retiring the prior task, but the one-task environment is still
not a production high-availability claim.

The application-only disable step intentionally removes the staging HTTPS API, gateway, worker,
service discovery, tracing policy, and heartbeat signals. During that bounded window:

- product API calls are unavailable;
- the two heartbeat alarms may notify because absence is expected;
- Auth0 and Temporal Cloud are not disabled;
- PostgreSQL, queues, artifacts, secrets, images, backups, and Terraform state remain available;
  and
- no other deployment, migration, restore, or test may run.

Start the disable window only when the exact reverse plan can be prepared and applied immediately.
Abort before disable if the operator cannot remain through re-enablement and verification.

## Read-only preflight

Run:

```powershell
.\scripts\operate-staging-application-recovery.ps1 -Action Status
```

Require:

- applications `enabled`;
- exactly two stable services;
- live/readiness `200`;
- protected unauthenticated access `401`; and
- no unexpected local recovery artifact.

The operator script reconstructs Terraform inputs from the exact live task definitions, service
configuration, migration task, database, and cluster. It never retrieves a secret value.

## Controlled rolling restart

After explicit authorization, run:

```powershell
.\scripts\operate-staging-application-recovery.ps1 -Action Restart -Execute
```

The script restarts the worker first and the gateway second. For each service it requires:

- exactly one original running task;
- the exact task definition to remain unchanged;
- gateway liveness `200` throughout every observed deployment poll;
- a distinct replacement task;
- final desired/running/pending `1/1/0`;
- one completed primary deployment; and
- final live/readiness/protected responses `200/200/401`.

It then requires an identical-input refresh-backed Terraform no-drift plan.

## Review the application-disable plan

Create, but do not apply, the refresh-backed plan:

```powershell
.\scripts\operate-staging-application-recovery.ps1 -Action PlanDisable
```

The plan is acceptable only when the sanitized output reports:

- zero creates;
- one in-place operations-dashboard update;
- exactly 16 deletes;
- zero replacements; and
- a SHA-256 checksum.

The 16 deletes must be only the five API Gateway resources, two Cloud Map resources, two task
definitions, two ECS services, one application tracing policy, two heartbeat metric filters, and
two heartbeat alarms. The dashboard update may only remove API/heartbeat presentation.

Reject any other action, including a persistent-data, migration, database, KMS, secret, queue,
registry, network, state, capacity, Redis, NAT, ALB, Multi-AZ, or identity/provider change.

## Apply the exact disable plan

After the checksum and boundary are reviewed and explicit authorization is given, run:

```powershell
.\scripts\operate-staging-application-recovery.ps1 `
  -Action ApplyDisable `
  -ExpectedPlanSha256 "<REVIEWED_SHA256>" `
  -Execute
```

The script re-inspects the saved plan, requires both the supplied and locally recorded checksums,
and applies that exact artifact. It then requires:

- zero ECS services and running tasks;
- zero platform API Gateway APIs;
- zero platform Cloud Map namespaces; and
- an identical-input applications-disabled Terraform no-drift plan.

Keep the disable plan and ignored context until the exact reverse plan has been generated.

## Review and apply exact re-enablement

Create the reverse plan:

```powershell
.\scripts\operate-staging-application-recovery.ps1 -Action PlanEnable
```

Require exactly 16 creates, one dashboard update, zero deletes, zero replacements, and no action
outside the same application boundary. Then explicitly authorize and apply only its checksum:

```powershell
.\scripts\operate-staging-application-recovery.ps1 `
  -Action ApplyEnable `
  -ExpectedPlanSha256 "<REVIEWED_SHA256>" `
  -Execute
```

The script requires both services to stabilize at `1/1/0`, live/readiness/protected responses to
return `200/200/401`, and the final identical-input Terraform plan to report no drift.

## Final application and operational acceptance

Before cleanup, additionally require:

1. the confirmed alert recipient receives any expected heartbeat `ALARM` and recovered `OK`
   notifications;
2. a synthetic authenticated preference/workflow transaction reaches a durable `succeeded`
   result;
3. gateway, worker, collector, outbox, Temporal, and trace evidence contains no error or forbidden
   sensitive-field patterns;
4. all eight staging alarms return to `OK`; and
5. the controlled interval and aggregate evidence contain no identities, tokens, raw provider
   values, resource identifiers, account identifiers, endpoint, or plan contents.

Only after these checks pass, remove the three local recovery artifacts:

```powershell
.\scripts\operate-staging-application-recovery.ps1 -Action Cleanup -Execute
```

Cleanup first revalidates stable enabled services and Terraform no drift, resolves every deletion
target inside the staging Terraform data directory, and removes only the disable plan, enable
plan, and recovery context created by the operator.
