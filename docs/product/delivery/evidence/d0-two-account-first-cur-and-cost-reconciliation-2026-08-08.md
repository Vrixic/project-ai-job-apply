# D0 two-account first CUR and cost reconciliation — 2026-08-08

## Scope

The read-only cost operator inspected development and staging independently because their distinct
IAM Identity Center sessions did not remain simultaneously cached. Both reads used the same
default August 2026 Cost Explorer window and returned only sanitized aggregate billing/control
evidence. No AWS resource, export, budget, alert, object, or account configuration changed.

## Accepted controls and delivery

Both isolated environments independently reported:

- a temporary IAM Identity Center caller;
- exactly one `$5 USD` monthly `COST` budget;
- exactly one expected actual-cost alert and zero other alerts;
- exactly one healthy CUR 2.0 export and zero other exports;
- two delivered Parquet objects and two manifests under the controlled `cur-2/` prefix; and
- `FirstCurDeliveryPresent=true`.

Development's latest observed delivery was `2026-08-08T12:35:19Z` with 144,765 aggregate delivered
bytes. Staging's was `2026-08-08T12:37:40Z` with 83,163 aggregate delivered bytes. Object keys,
buckets, account identifiers, destinations, and raw report contents were not retained.

## Partial-month attribution

The current estimated August window reports:

| Environment | Estimated unblended cost | Largest attributed services |
|---|---:|---|
| Development | `$22.6557` | VPC `$8.0895`; RDS `$6.5354`; historical ECS `$5.4271` |
| Staging | `$10.4745` | RDS `$3.2677`; VPC `$3.2095`; historical ECS `$2.7291` |
| **Combined** | **`$33.1302`** | Persistent VPC/RDS dominate after separating historical ECS usage |

The remaining smaller charges are attributable to Route 53, KMS, Secrets Manager, ECR, Cost
Explorer, S3, API Gateway, Lambda, and a negligible historical Cloud Map amount. No unexplained
service appeared. Credits are not treated as steady-state economics.

This is a partial, estimated calendar-month observation containing Fargate/ECS activity incurred
before the August 8 retirement. It proves first CUR delivery, nonzero staging billing, expected
controls, and explainable attribution, but it cannot prove the post-retirement daily steady state
or zero new ECS compute. SR-010 therefore remains in progress until one complete UTC day wholly
after retirement posts in both accounts and shows no gateway/worker ECS compute accrual.

The product owner scheduled that final read-only observation for August 11, 2026. It will inspect
the complete UTC day from `2026-08-09` through `2026-08-10` independently in each account. This
dated deferral does not waive or pass SR-010.
