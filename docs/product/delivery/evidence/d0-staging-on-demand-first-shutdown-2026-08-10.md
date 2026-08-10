# D0 Staging On-Demand First Shutdown — 2026-08-10

## Disposition

The first guarded synthetic-staging shutdown completed from clean merged `main` in the isolated
staging AWS account. Two separately reviewed and checksum-authorized Terraform applies moved the
environment from `active` through `quiesced` to `dormant`. The final read-back has no PostgreSQL
instance, managed interface endpoint, public runtime route, enabled workflow trigger, or queued
work. The retained control plane remains present.

This completes D0-017's initial shutdown task. It does not complete D0-017: a subsequent
`dormant -> active` recreation, migration/fixture/conformance exercise, return to dormant, and one
complete posted dormant billing interval remain required.

## Source and operator provenance

- [PR #195](https://github.com/Vrixic/project-ai-job-apply/pull/195) merged ADR-018, the explicit
  `active`/`quiesced`/`dormant` Terraform composition, invariants, resource-policy tests, guarded
  lifecycle operator, runbook, and living delivery record.
- The first local plan attempt failed before review or AWS mutation because PowerShell passed the
  Terraform output path as a literal `$resolvedPlan` argument. The incorrectly named ignored local
  plan was removed.
- [PR #196](https://github.com/Vrixic/project-ai-job-apply/pull/196) corrected native argument
  quoting, made rejected plans self-cleaning, and constrained quiescence to exactly seven approved
  actions. PowerShell parsing/help, `git diff --check`, and the full local `pnpm check` passed.
  GitHub-hosted jobs did not acquire runners because the repository Actions spending allowance was
  exhausted; they are not represented as executed test evidence.
- Both deployed plans required temporary IAM Identity Center credentials, the exact isolated
  account and KMS-encrypted state backend, Terraform `1.9.8`, clean `main` exactly matching
  `origin/main`, empty queues, strict action allowlists, saved-plan SHA-256 review, and the product
  owner's exact checksum approval.

No account identifier, bucket name, secret value, candidate value, or raw artifact is recorded here.

## Active preflight

The read-only operator reported:

```json
{
  "Environment": "staging",
  "Mode": "active",
  "DatabasePresent": true,
  "DatabaseDeletionProtection": true,
  "ManagedInterfaceEndpoints": 3,
  "PublicRuntimeRoutes": 3,
  "EnabledEventMappings": 1,
  "EnabledEventRules": 2,
  "AggregateQueueDepth": 0
}
```

## Quiescence transition

The refresh-backed plan created at `2026-08-10T18:47:01Z` contained exactly seven changes and no
replacement or unrelated action:

- delete the default API route plus the public liveness and readiness routes;
- disable the SQS outbox-starter mapping;
- disable the outbox-reconciler and terminal-workflow EventBridge rules; and
- change RDS deletion protection `true -> false`, `skip_final_snapshot false -> true`, and delete
  automated backups in preparation for the separately reviewed synthetic database deletion.

Reviewed SHA-256:

```text
6c072d4bb82c0e524100230ce88c174bb5a0fc9aa27cf37c29451289586cff48
```

After the exact apply, the operator reported `Mode=quiesced`, one present database with deletion
protection false, three endpoints, zero public routes, zero enabled mappings/rules, and empty queues.
Nothing was deleted during this transition.

## Dormant transition

The separately refresh-backed plan created at `2026-08-10T18:55:38Z` contained eight deletes and
one in-place dashboard update, with no replacement or unrelated action:

- delete the synthetic Single-AZ RDS instance without a final snapshot and delete its automated
  backups;
- delete the current generated database-secret version;
- delete the Secrets Manager, SQS, and Lambda interface endpoints;
- delete the current on-demand migration task definition and two database-specific alarms; and
- point the retained PostgreSQL dashboard widget at the explicit dormant placeholder.

Reviewed SHA-256:

```text
6af6b71a76a76ab49d9458e198bc3762efbe70a4c0b2933cc71026602af84dab
```

The product owner explicitly authorized the irreversible synthetic-data deletion. Terraform
completed successfully after AWS finalized the managed RDS deletion.

## Final deployed read-back

The final lifecycle status was:

```json
{
  "Environment": "staging",
  "Mode": "dormant",
  "DatabasePresent": false,
  "DatabaseDeletionProtection": false,
  "ManagedInterfaceEndpoints": 0,
  "PublicRuntimeRoutes": 0,
  "EnabledEventMappings": 0,
  "EnabledEventRules": 0,
  "AggregateQueueDepth": 0
}
```

At `2026-08-10T19:12:27Z`, a read-only remote-state inventory contained 119 retained resources and
zero resources matching the approved disposable boundary. Aggregate retained inventory included:

- one platform KMS key, one artifact bucket, and one migration ECR repository;
- three queues/DLQs, five Lambda functions, and one API definition;
- one application log group and one alert-delivery topic; and
- seven IAM roles.

The exact plan also left encrypted/versioned Terraform state, immutable artifacts, the remaining
logs/alarms, budgets, and CUR export outside the deletion boundary.

## Cost and follow-up boundary

The staging RDS instance and all three hourly interface endpoints stopped accruing future
resource-hours after deletion. Cost Explorer and CUR reporting lag, so this record does not claim
an immediate billed-dollar reduction or a complete dormant interval.

Remaining D0-017 evidence:

1. Generate and apply an independently reviewed dark `dormant -> active` plan with no deletes.
2. Run migrations, create approved synthetic records through the owned authenticated conformance
   boundary, and replay persistence, readiness, workflow, idempotency, isolation, workload,
   observability, restore/security, and zero-drift checks before enabling traffic.
3. Return the exercise through separately reviewed `quiesced` and `dormant` plans.
4. Reconcile one complete posted dormant interval and confirm no RDS or interface-endpoint hourly
   usage.
