# Initial Operating-Cost Baseline

- Status: Planning estimate; no provider billing evidence exists
- Pricing checked: 2026-07-28
- Region: AWS `us-east-2`
- Currency: USD, before tax

## Purpose and limits

This baseline estimates the lean-until-demand architecture in ADR-013. It is not an invoice,
quote, cost ceiling, or substitute for a reviewed AWS Pricing Calculator estimate and deployed
Cost and Usage Report. Data transfer, logs, model tokens, document sizes, support, taxes, discounts,
credits, and third-party pricing can change the result.

The estimate deliberately excludes idle ALB, NAT, Redis, Multi-AZ database, service replicas,
always-on staging, dedicated search, and browser fleets. Security, backups, encryption, durable
workflows, and observability remain included.

## Current lean AWS development footprint

Assumptions:

- 730 hours/month;
- one gateway task at 0.25 vCPU and 0.5 GB;
- one worker task at 0.5 vCPU and 1 GB;
- one public IPv4 address per running Fargate task, with security-group ingress restricted to the
  API Gateway VPC Link;
- one Single-AZ `db.t4g.micro` PostgreSQL instance with 20 GB GP3;
- two customer-managed KMS keys and two Secrets Manager secrets;
- low development traffic, object storage, image storage, logs, queue traffic, Cloud Map lookups,
  and API requests.

| Item | Monthly estimate |
|---|---:|
| Gateway Fargate compute | $9.01 |
| Worker Fargate compute | $18.02 |
| Two public IPv4 addresses | $7.30 |
| RDS `db.t4g.micro` compute | $11.68 |
| RDS 20 GB GP3 storage | $2.30 |
| Two KMS keys | $2.00 |
| Two Secrets Manager secrets | $0.80 |
| Cloud Map/Route 53 private namespace | about $0.60 plus low lookup usage |
| API Gateway, ECR, S3, SQS, CloudWatch, KMS/API requests and transfer | budget $3–$10 at low use |
| **Lean Phase 0 AWS estimate** | **about $55–$62/month** |

A separately deployed web task at the same 0.25 vCPU/0.5 GB size plus one IPv4 address adds about
$12.66/month. A working web/gateway/worker environment therefore starts around **$68–$75/month**
before workflow/model providers.

The compute rates use the official AWS `us-east-2` public price list: Linux/x86 Fargate is
$0.04048 per vCPU-hour and $0.004445 per GB-hour. RDS PostgreSQL `db.t4g.micro` Single-AZ is
$0.016/hour and GP3 storage is $0.115/GB-month. AWS charges $0.005/hour for each public IPv4
address.

Sources:

- [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/)
- [AWS RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/)
- [AWS public IPv4 pricing](https://aws.amazon.com/vpc/pricing/)
- [AWS API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/)
- [AWS Cloud Map pricing](https://aws.amazon.com/cloud-map/pricing/)
- [AWS KMS pricing](https://aws.amazon.com/kms/pricing/)
- [AWS Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/)

## Required and variable providers

| Provider/capability | Initial cash cost | Steady-state planning cost | Notes |
|---|---:|---:|---|
| Auth0 | $0 | $0 initially; $35/month when Essentials is required | Free currently includes one tenant and up to 25,000 MAU. Essentials currently starts at $35/month and includes three tenants. |
| Temporal Cloud Essentials | $0 while eligible credits remain | starts at $100/month | Temporal advertises $1,000 starting credits; eligibility and expiration must be confirmed before relying on them. |
| AI/model API | usage based | budget $6–$15 per 100 applications for the example below | Provider/model is not yet selected; enforce hard budgets. |
| SES transactional email | effectively $0 at initial volume | $0.10 per 1,000 outbound emails plus data | Do not buy dedicated IP or deliverability add-ons initially. |
| Domain/DNS | provider dependent | roughly $1–$3/month amortized | Final public domain is a D6 decision. |
| GitHub | $0 under applicable free limits | usage/plan dependent | Re-evaluate Actions usage when CI volume is measurable. |

Official provider pages:

- [Auth0 pricing](https://auth0.com/pricing)
- [Temporal Cloud pricing](https://temporal.io/pricing)
- [OpenAI model pricing](https://developers.openai.com/api/docs/models)
- [Amazon SES pricing](https://aws.amazon.com/ses/pricing/)

## AI example—not a model decision

For a planning example of 30,000 uncached input tokens and 5,000 output tokens per prepared
application:

| Model class | Published token price | Estimated cost/application | 100 applications |
|---|---|---:|---:|
| Cost-sensitive (`gpt-5.6-luna` example) | $1/M input; $6/M output | about $0.06 | about $6 |
| Balanced (`gpt-5.6-terra` example) | $2.50/M input; $15/M output | about $0.15 | about $15 |

Actual prompts may be materially larger or smaller. The model gateway must record tokens and cost
by extraction, matching, document, answer, and application workflow; cache job-level work and use
deterministic transformations where quality is equal.

## Cash scenarios

| Scenario | Expected monthly cash need |
|---|---:|
| Local-only engineering with small model tests | about $5–$20 |
| Lean Phase 0 cloud while Temporal credits cover its minimum | about $60–$85 |
| Lean working web product with 100 AI-prepared applications while Temporal credits remain | about $75–$100 |
| Same working product after Temporal credits | about $175–$200 |
| Pre-launch with Auth0 Essentials and one active lean runtime | about $210–$240 plus usage |

Do not count AWS, Auth0 startup, or Temporal promotional credits as steady-state economics.
Eligible credits can reduce early cash expenditure, but the product must still make sense after
they expire.

## Largest fixed-cost decision

Temporal Cloud's current $100/month Essentials minimum is larger than the lean AWS platform. Use
the advertised credit only after confirming its terms. Before the credit is exhausted, compare:

1. keeping Temporal Cloud for managed reliability and low operational burden;
2. an explicitly non-production self-hosted Temporal development profile; or
3. another durable-workflow implementation that still satisfies ADR-004 semantics.

Changing workflow infrastructure is an architectural decision, not an informal cost toggle.

## Cost controls and evidence

- Set AWS Budgets alerts at $25, $50, $75, and $100 for development.
- Tag every resource and enable Cost and Usage Reports before the first apply.
- Keep staging unprovisioned except for scheduled evidence work; record its actual daily cost.
- Scale development ECS tasks down when no shared testing is scheduled, without deleting durable
  state.
- Record per-application AI tokens, browser minutes, object bytes, Temporal actions, notifications,
  retries, and support time.
- Reconcile this estimate against the first complete billing month and update D0-008.
