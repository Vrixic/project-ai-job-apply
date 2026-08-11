# D0 Post-Retirement Cost Acceptance — 2026-08-11

## Disposition

The complete `2026-08-09` UTC interval passes the post-retirement operating-cost gate independently
in development and staging. Caller-account-scoped reads on August 10 and August 11 returned the
same attributable values, no ECS/Fargate service charge, healthy budget/export controls, and fresh
CUR 2.0 delivery. This completes D0-008's initial cost measurement, SR-010, and D0-016.

AWS still marks both results estimated because they are part of the open August billing period.
That flag is retained in the evidence but is not an appropriate same-month engineering gate: AWS
describes current-month charges as estimated and previous closed months as final. Invoice
finalization remains normal monthly financial reconciliation rather than a blocker for proving
that the retired gateway/worker compute stopped accruing cost.

This acceptance does not complete D0-017's separate dormant-staging interval, accountable
legal/privacy or security/privacy review, representative ATS fixture acquisition, or the Phase 0
exit review.

## Commands

The operator used separately refreshed temporary IAM Identity Center sessions:

```powershell
.\scripts\inspect-phase0-cost.ps1 -Environment development -StartDate 2026-08-09 -EndDate 2026-08-10
.\scripts\inspect-phase0-cost.ps1 -Environment staging -StartDate 2026-08-09 -EndDate 2026-08-10
```

No AWS resource, budget, export, object, application record, or configuration changed.

## Account-scoped results

| Service | Development | Staging | Combined |
|---|---:|---:|---:|
| Amazon Virtual Private Cloud | `$0.7200` | `$0.7200` | `$1.4400` |
| Amazon RDS | `$0.4654` | `$0.4637` | `$0.9291` |
| AWS KMS | `$0.0645` | `$0.0645` | `$0.1290` |
| AWS Secrets Manager | `$0.0130` | `$0.0130` | `$0.0260` |
| ECR, S3, and Lambda | `$0.0003` | `$0.0003` | `$0.0006` |
| **Total** | **`$1.2632`** | **`$1.2614`** | **`$2.5246`** |

Neither account returned an Amazon ECS service group. Observed ECS/Fargate unblended cost is zero
for the complete inspected interval. The values exactly match the corrected August 10 preliminary
read after another Cost Explorer/CUR refresh cycle.

## Control evidence

Each account independently returned:

- a temporary IAM Identity Center caller;
- `CostScope=caller-account-only`;
- exactly one `$5 USD` monthly `COST` budget;
- exactly one expected actual-cost alert and zero unexpected alerts;
- exactly one healthy CUR 2.0 export and zero unexpected exports;
- two Parquet objects and two manifests; and
- a fresh August 11 CUR delivery.

The development payer-account aggregation risk remains controlled by the exact caller-account
`LINKED_ACCOUNT` filter.

## Acceptance rationale

D0-016 required an attributable complete post-retirement day with no new gateway/worker Fargate
compute. It did not require an August invoice to close before the engineering architecture could be
accepted. The repeated stable daily reads, independent account scope, fresh CUR delivery, absence
of the ECS service line, retired-resource inventory, zero running ECS services/tasks, and prior
deployed conformance jointly satisfy that requirement.

AWS references:

- [Understanding your bill](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/getting-viewing-bill.html)
- [Exploring Cost Explorer data](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-exploring-data.html)

The first full dormant staging day begins after the August 10 return to dormancy. D0-017 must use
the explicit dormant verifier after that complete UTC interval posts and require zero RDS
instance-hours and zero VPC endpoint-hours.
