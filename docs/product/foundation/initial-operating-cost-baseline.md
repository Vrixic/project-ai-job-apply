# Initial Operating-Cost Baseline

- Status: First two-account CUR/cost delivery reconciled; complete post-retirement day pending
- Pricing basis checked: 2026-07-28; recheck before launch or a material architecture decision
- Region: AWS `us-east-2`
- Currency: USD, before tax

## Purpose and limits

This baseline estimates the lean-until-demand architecture in ADR-013 and ADR-016. It is not an
invoice, quote, spending cap, or substitute for Cost and Usage Report evidence. Data transfer,
logs, durable execution, model tokens, document sizes, support, taxes, discounts, and provider
pricing can change the result.

The estimate excludes idle ALB, NAT, Redis, Multi-AZ database, application replicas, dedicated
search, and browser fleets. Security, backups, encryption, durable workflows, and observability
remain included.

## Current lean AWS environment footprint

An active isolated environment has:

- zero continuously running gateway or workflow containers and no application public IPv4;
- API Gateway plus bounded versioned Lambda functions and Lambda durable execution;
- one Single-AZ `db.t4g.micro` PostgreSQL instance with 20 GB GP3;
- customer-managed KMS boundaries, one database secret, encrypted queues/DLQ and artifact storage;
- Secrets Manager, SQS, and Lambda interface endpoints for private database/workflow Lambdas;
- an empty ECS cluster and a scanned migration-only repository/task used only on demand; and
- CloudWatch logs, metrics, alarms, dashboard, AWS Budget, and CUR 2.0 export storage.

Approximate low-traffic monthly planning ranges per continuously provisioned account:

| Item | Monthly planning range |
|---|---:|
| RDS `db.t4g.micro` plus 20 GB GP3 | about $14 |
| Customer-managed KMS keys and one runtime secret | about $2–$4 |
| Three interface endpoints in one reviewed subnet | about $22 plus data |
| API Gateway, Lambda/durable execution, SQS/DLQ, S3/ECR, logs and transfer | about $3–$12 at low use |
| Idle ECS application compute and application public IPv4 | $0 |
| **Active lean environment planning range** | **about $39–$52/month before provider/usage growth** |

Under ADR-018, development stays active for routine integration. Synthetic staging's target dormant
state removes RDS and all three interface endpoints while retaining encrypted state, keys, artifacts,
identity, queues, logs, alarms, budgets, and exports. The retained dormant planning range is about
`$3–$10/month` at low use. D0-017 must still apply, reactivation-test, and return this source boundary
to dormant before that range is treated as deployed evidence.

Official pricing references:

- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- [AWS Lambda durable functions pricing](https://aws.amazon.com/lambda/pricing/)
- [AWS RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/)
- [AWS PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/)
- [AWS API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/)
- [AWS KMS pricing](https://aws.amazon.com/kms/pricing/)
- [AWS Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/)

## Required and variable providers

| Provider/capability | Initial cash cost | Steady-state planning cost | Notes |
|---|---:|---:|---|
| Auth0 | $0 | $0 initially; paid plan when tenant/feature limits require it | Development currently uses the Free-plan boundary; dedicated staging/production tenant decisions remain a launch gate. |
| AI/model API | usage based | budget $6–$15 per 100 applications for the example below | Provider/model is not yet selected; enforce hard budgets. |
| SES transactional email | effectively $0 at initial volume | $0.10 per 1,000 outbound emails plus data | Do not buy dedicated IP or deliverability add-ons initially. |
| Domain/DNS | provider dependent | roughly $1–$3/month amortized | Final public domain is a D6 decision. |
| GitHub | $0 under applicable free limits | usage/plan dependent | Re-evaluate Actions usage when CI volume is measurable. |

The retired Phase 0 workflow provider has no supported runtime dependency or planned recurring
product cost. Historical credits and charges remain billing evidence, not part of the target
architecture.

## AI example—not a model decision

For a planning example of 30,000 uncached input tokens and 5,000 output tokens per prepared
application:

| Model class | Planning token price | Estimated cost/application | 100 applications |
|---|---|---:|---:|
| Cost-sensitive example | $1/M input; $6/M output | about $0.06 | about $6 |
| Balanced example | $2.50/M input; $15/M output | about $0.15 | about $15 |

Actual prompts may be materially larger or smaller. The model gateway must record tokens and cost
by extraction, matching, document, answer, and application workflow; cache job-level work and use
deterministic transformations where quality is equal.

## Cash scenarios

| Scenario | Expected monthly cash need |
|---|---:|
| Local-only engineering with small model tests | about $5–$20 |
| One active lean AWS environment at low traffic | about $39–$52 |
| Active development plus dormant synthetic staging | about $42–$62 |
| Development plus temporarily active synthetic staging | about $78–$104 |
| One active environment plus 100 AI-prepared applications | about $45–$67 plus browser/document usage |

Do not count promotional credits as steady-state economics. The largest fixed AWS costs are now
the persistent database and private service endpoints rather than idle application compute.
ADR-018 removes those resources from synthetic staging between evidence windows through a guarded
Terraform state machine while preserving accepted isolation, restore, and reproducibility controls.

## Cost controls and evidence

- Keep one `$5` monthly AWS Budget actual-cost alert independently in development and staging.
- Tag every resource and retain account-local CUR 2.0 Data Exports in private versioned storage.
- Keep staging use scheduled and record actual daily cost; do not claim it has an automatic cap.
- Record per-application AI tokens, browser minutes, object bytes, Lambda/durable invocations,
  notifications, retries, and support time.
- Reconcile the first complete post-retirement billing window against exact service-attributed
  development and staging charges before completing D0-008.

The August 8 first-delivery read proves one expected `$5` budget/alert, one healthy export, two
Parquet objects, two manifests, and zero unexpected controls independently in each account.
Estimated partial-month unblended cost is `$22.6557` in development and `$10.4745` in staging.
VPC and RDS are the largest persistent categories; `$5.4271` development and `$2.7291` staging ECS
charges are attributable to the pre-retirement part of the same month. This partial period cannot
prove the post-retirement steady state. One complete UTC day wholly after retirement must post and
show no new gateway/worker ECS compute before D0-008/SR-010 cost acceptance closes.
