# Cost Controls Module

Creates one same-account monthly actual-cost budget and one AWS Data Exports Cost and Usage Report
2.0 (CUR 2.0) destination. It publishes thresholds to the environment's encrypted operational SNS
topic and retains resource-attributed Parquet exports in a private, versioned, TLS-only S3 bucket.

The module deliberately keeps development and staging billing evidence in their respective AWS
accounts. AWS Budgets alerts after billing data updates; it is not a hard spending cap. CUR 2.0 is
configured through the `us-east-1` billing endpoint while its destination bucket remains in the
environment's primary region. AWS Data Exports delivers using SSE-S3; changing delivered objects
to KMS encryption requires a separate post-delivery workflow and must not be inferred from bucket
defaults.

Expected subfolders are unnecessary at this size. Split policy fixtures or automated cost-query
assets into named subfolders only when they become independently owned capabilities.
