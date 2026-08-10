# D0 Post-Retirement Cost Preliminary Read — 2026-08-10

## Scope and disposition

The read-only Phase 0 cost operator inspected the complete UTC interval from `2026-08-09` through
`2026-08-10` independently in development and staging. Both accounts have attributable nonzero
cost, no ECS/Fargate service charge, one exact `$5` budget/alert, one healthy CUR 2.0 export, and
real Parquet/manifest delivery. AWS Cost Explorer still marks the interval estimated, so this is
preliminary evidence and does not complete D0-008, SR-010, or D0-016.

No AWS resource, budget, export, object, application record, or configuration changed.

## Payer-account correction

The first development read returned `$2.5246`, almost exactly twice staging in every fixed-cost
category. Investigation proved that development is the AWS Organizations payer and the operator's
unfiltered Cost Explorer query included linked-account spend. The output was rejected as
development-only evidence.

The operator now filters `LINKED_ACCOUNT` to the temporary caller's exact account and emits
`CostScope=caller-account-only`. It does not print the account identifier. The corrected query
returned `$1.2632` for development, while staging remained `$1.2614`. The combined value is the
original `$2.5246`, confirming the aggregation diagnosis without changing cloud state.

## Account-scoped results

| Service | Development | Staging | Combined |
|---|---:|---:|---:|
| Amazon Virtual Private Cloud | `$0.7200` | `$0.7200` | `$1.4400` |
| Amazon RDS | `$0.4654` | `$0.4637` | `$0.9291` |
| AWS KMS | `$0.0645` | `$0.0645` | `$0.1290` |
| AWS Secrets Manager | `$0.0130` | `$0.0130` | `$0.0260` |
| ECR, S3, and Lambda | `$0.0003` | `$0.0003` | `$0.0006` |
| **Total** | **`$1.2632`** | **`$1.2614`** | **`$2.5246`** |

Neither account returned an ECS service group, so observed ECS/Fargate unblended cost is zero for
the inspected interval. VPC endpoint-hours and the continuously available Single-AZ PostgreSQL
instances dominate the idle footprint, as expected from the deployed architecture.

## Control evidence

Each account independently returned:

- a temporary IAM Identity Center caller;
- `CostScope=caller-account-only`;
- exactly one `$5 USD` monthly `COST` budget;
- exactly one expected actual-cost alert and zero unexpected alerts;
- exactly one healthy CUR 2.0 export and zero unexpected exports;
- two Parquet objects and two manifests; and
- `FirstCurDeliveryPresent=true`.

## Remaining acceptance

Repeat the same exact account-scoped reads after Cost Explorer reports `Estimated=false`. Require
the values to remain attributable and ECS/Fargate to remain absent. Only that finalized read can
close the post-retirement cost gate.
