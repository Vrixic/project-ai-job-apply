# D0 Cost-Control Infrastructure Preflight — 2026-07-31

## Scope

This record covers the source implementation and no-mutation staging preview for the D0-008 AWS
budget/export controls. It does not claim that either account has been changed, that a billing
export has been delivered, that provider costs have posted, or that D0-008 is complete.

## Reviewed design

Each isolated AWS account receives:

- one monthly actual-cost AWS Budget, excluding credits and refunds from the steady-state signal;
- absolute alerts delivered to the account's existing encrypted operational SNS topic;
- one recommended CUR 2.0 AWS Data Export through the `us-east-1` billing endpoint;
- daily resource-attributed Parquet output in an account-local `us-east-2` bucket; and
- bucket-owner-enforced objects, public-access blocking, TLS-only access, versioning, SSE-S3,
  90-day noncurrent-version cleanup, and 400-day current-object retention.

Development uses a $100 monthly reference with $25/$50/$75/$100 actual-cost alerts. On-demand
staging uses a $50 monthly reference with $10/$25/$50 alerts. These alerts do not stop resources or
cap spending. CUR 2.0 delivery can take up to 24 hours to begin, and its S3 storage is billed at
standard rates.

The existing customer-managed platform key and SNS policy gain only the same-account AWS Budgets
producer permissions required for encrypted alert delivery. The GitHub deployment role boundary
gains AWS Budgets, BCM Data Exports, and the required CUR report-definition permission; that
bootstrap policy must be applied separately in each account before GitHub OIDC manages the new
controls.

Primary references:

- [AWS Data Exports overview](https://docs.aws.amazon.com/cur/latest/userguide/what-is-data-exports.html)
- [Data Exports S3 policy](https://docs.aws.amazon.com/cur/latest/userguide/dataexports-s3-bucket.html)
- [AWS Budgets encrypted SNS policy](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-sns-policy.html)

## No-mutation preview

Terraform 1.9 validation passed for the shared modules, bootstrap, and staging composition. A
refresh-backed staging preview targeted only the new cost-control module and its explicit encrypted
notification dependencies. It reported:

- nine creates: budget, CUR 2.0 export, S3 bucket, ownership, public-access block, encryption,
  versioning, lifecycle, and bucket policy;
- two in-place updates: the existing platform KMS key policy and operational SNS topic policy;
- zero deletes; and
- zero replacements.

The temporary preview plan was removed after sanitized inspection. Because this was a targeted
scope preview, it is not a full-environment no-drift claim and must not be applied. Exact
environment-specific bootstrap and full platform plans must be generated from merged source and
reviewed before either apply.

## Remaining acceptance

D0-008 remains open until all of the following pass:

1. refresh both temporary IAM Identity Center sessions;
2. plan, review, and apply the bootstrap permission updates independently in development and
   staging;
3. generate full exact-input platform plans, require the reviewed change set, and apply them
   independently;
4. verify one budget and one CUR 2.0 export in each account, encrypted alert compatibility, private
   bucket controls, first healthy export delivery, and final no drift; and
5. record nonzero, service-attributed costs for both accounts and reconcile them against the
   initial operating-cost baseline.
