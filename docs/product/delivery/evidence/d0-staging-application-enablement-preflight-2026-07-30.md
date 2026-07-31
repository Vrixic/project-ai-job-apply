# D0 Staging Application Enablement Preflight — 2026-07-30

## Scope

This record covers the refresh-backed prerequisite checks and saved Terraform plan for enabling
the lean gateway and workflow worker in synthetic-only staging. It does not prove an apply,
application health, Auth0 token validation, owner isolation, workflow completion, observability
delivery, rollback, restore, workload baselines, cost attribution, or Phase 0 completion.

No AWS application resource changed during this preflight.

## Source and boundary

- Terraform source: merged `main` commit `bc9feca89c0cf673a0e844ee9e7b30c95eefb0ee`.
- Terraform: `1.9.8`.
- Caller: temporary IAM Identity Center staging administrator session; development/staging AWS
  account inequality passed without retaining identifiers.
- State: the existing staging `platform.tfstate`, reinitialized locally against its exact private
  versioned KMS-encrypted S3 backend. The local metadata refresh did not migrate or modify state.
- Data/provider boundary: AWS state/data and the Temporal namespace/key are staging-isolated.
  Staging temporarily trusts the exact development Auth0 issuer only under
  [ADR-014](../../../adr/014-shared-development-auth0-for-synthetic-staging.md), so this plan does
  not claim identity-provider isolation.
- Data classification: synthetic identities and synthetic product data only; no real users,
  invited testers, public access, live ATS submissions, or release-candidate use.

## Prerequisites verified

- The applications-disabled persistent staging state was refresh-backed and drift free.
- Staging contained zero ECS services and zero running ECS tasks.
- The controlled staging database migration previously completed with exit code `0`.
- The exact gateway and worker `linux/amd64` manifests recorded in staging image evidence still
  exist. Both ECR scans report `COMPLETE` with zero critical, high, medium, and low findings.
- The exact Auth0 issuer passed public discovery, issuer equality, RS256 support, and RSA signing
  JWKS checks. No client/Management API/session secret is supplied to staging AWS.
- The isolated staging Temporal secret has exactly one `AWSCURRENT` version. Secret-safe
  conformance again passed AWS caller/region/secret alignment, TLS authentication, and namespace
  read access without printing a value or environment identifier.
- The lean inputs remain one gateway task, one worker task, Single-AZ PostgreSQL, public-subnet
  restricted application egress, no Redis, no NAT, no ALB, no Multi-AZ, no enhanced container
  insights, and no database performance insights.

## Saved plan review

The saved plan has SHA-256:

`83FA307C694D75F3E1AD9F73D36B56658F7E3660FE6C6ACCBB539151FD9EE142`

Allowlist review confirmed:

- 16 creates:
  - five regional API Gateway resources;
  - two Cloud Map resources using the required `SRV` service;
  - one gateway task definition and one gateway service;
  - one worker task definition and one worker service;
  - one bounded two-action tracing policy; and
  - two heartbeat metric filters plus two missing-signal alarms;
- one in-place update to the existing operations dashboard for API Gateway and heartbeat
  visibility;
- zero replacements and zero deletes;
- exact approved immutable gateway/worker platform digests;
- the gateway-compatible migration image remains unchanged;
- the exact temporary Auth0 issuer, stable audience, and isolated staging Temporal endpoint and
  namespace are present without being retained in this record; and
- every lean capacity/network/data-service flag remains at its reviewed value.

The initial shell passed the output filename as a literal variable name. Terraform produced the
valid plan but the first inspection looked at the intended path and stopped. The artifact was
renamed within the staging workspace without regeneration or modification, then its exact
contents and checksum passed the allowlist review above. No apply was attempted.

The local plan file may contain sensitive state values. It is ignored by Git, remains local for
the exact reviewed apply, and must be deleted after its hash and apply result are recorded.

## Next authorization and acceptance

The plan is reviewed but not applied. After this runbook/evidence change is merged, an accountable
operator may explicitly authorize applying only the checksum-matched artifact under the
[staging application rollout runbook](../../../../infrastructure/runbooks/deployments/staging-application-rollout.md).

After apply, prove no drift, service/task/digest health, Cloud Map, live/readiness/unauthenticated
responses, sanitized startup/heartbeat logs, isolated Temporal workflow completion, synthetic
authenticated persistence, deployed cross-user denial, traces/alarms/notifications, and an
application-only rollback path. Evidence remains synthetic-only and cannot close the dedicated
Auth0 tenant launch gate.
