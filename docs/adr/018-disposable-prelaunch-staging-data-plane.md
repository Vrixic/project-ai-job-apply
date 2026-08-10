# ADR-018: Disposable Prelaunch Staging Data Plane

Status: Accepted
Date: 2026-08-10

## Context

Development is the continuous prelaunch integration environment. Staging exists to verify an exact
release candidate in an isolated AWS account, not to serve users or preserve product records between
exercises. After the application runtime moved to API Gateway and Lambda, measured staging idle cost
was dominated by one RDS PostgreSQL instance and three interface VPC endpoints rather than compute.

Temporarily stopping RDS is not a durable dormant state because AWS automatically restarts a stopped
instance after seven days. Interface endpoints are billed for every provisioned endpoint-hour even
without traffic. See the AWS documentation for [RDS temporary stops](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_StopDBInstance.html)
and [PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/).

The platform must preserve environment isolation, deterministic releases, migration safety,
authorization, recovery evidence, and Terraform ownership. Cost reduction must not create an
untracked collection of manually stopped or partially configured resources.

## Decision

Keep development continuously usable and operate prelaunch staging as an explicit Terraform-managed
state machine:

1. `active`: the private PostgreSQL data plane and three interface endpoints exist. Database deletion
   protection is enabled. Public routes and workflow triggers may be enabled only after migrations
   and conformance pass.
2. `quiesced`: public routes and workflow triggers are disabled, queues are empty, PostgreSQL remains
   available, and database deletion protection is disabled. This state exists only to create a
   separately reviewable boundary before destructive shutdown.
3. `dormant`: PostgreSQL, its Terraform-managed current connection value, RDS alarms, the current
   migration task definition, and the Secrets Manager/SQS/Lambda interface endpoints are absent.
   Public routes and workflow triggers remain disabled.

Dormant staging retains its isolated AWS account, encrypted versioned Terraform state, KMS keys,
artifact and cost-export buckets, immutable Lambda artifacts, migration ECR repository, IAM
boundaries, queues/DLQs, API/Lambda definitions, logs, alert delivery, budgets, and CUR export. These
resources either provide reproducibility/control evidence or have negligible idle usage cost.

The staging database contains synthetic data only and is destroyed without a final retained snapshot.
No real candidate, ATS submission, credential, or production artifact is permitted in staging. Every
activation creates a fresh encrypted Single-AZ PostgreSQL instance, restores private endpoints, runs
the exact migration image, and verifies schema and application boundaries before separately
enabling serverless traffic. Phase 0 profile/workflow records are created only through approved
disposable authenticated conformance because ownership derives from OIDC identity; a later
capability may load approved synthetic fixtures only through its explicit owned seed contract.

Every transition uses temporary staging IAM Identity Center credentials, a clean `main` commit,
environment-specific KMS-encrypted state, a refresh-backed saved Terraform plan, strict resource
action allowlists, and an explicitly approved SHA-256. Turning off always requires two separately
applied transitions: `active -> quiesced -> dormant`. A direct active-to-dormant destroy is rejected.

## Consequences

- Staging no longer accumulates continuous RDS instance or interface-endpoint hourly charges while
  dormant.
- Staging activation takes longer than a normal application release because database provisioning,
  migrations, synthetic seeding, and conformance are mandatory.
- Persistent staging test records do not survive shutdown. Evidence records only aggregate,
  privacy-safe results in the repository or approved evidence storage.
- The retained dark Lambda/API control plane is intentionally unreachable in dormant mode. This is a
  fail-closed posture, not an available degraded service.
- Restore/PITR exercises require active staging and must finish before shutdown. Their disposable
  restored copies must be removed before quiescence.
- Production is not governed by this decision. Production data retention, availability, backups,
  deletion protection, and recovery remain separate launch decisions.

## Compatibility and supersession

This ADR refines ADR-013's on-demand-staging requirement and ADR-016's normally-disabled staging
application posture. It does not weaken ADR-007 account/state isolation, ADR-008 privacy-safe
observability, or any legal/security release gate.

## Alternatives

- Stop RDS and leave endpoints provisioned. Rejected because RDS restarts automatically after seven
  days and the endpoints keep accruing hourly charges.
- Destroy the entire staging account foundation. Rejected because rebuilding state, trust, evidence,
  keys, artifacts, and cost controls increases recovery risk without meaningful savings.
- Share development's database or network. Rejected because it defeats isolated release,
  authorization, migration, and destructive-test evidence.
- Keep a final staging database snapshot. Deferred because prelaunch staging is synthetic and
  reproducible; retaining snapshots adds cost and stale-data handling without a recovery objective.
