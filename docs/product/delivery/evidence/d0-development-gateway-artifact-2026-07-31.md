# D0-016 Development Gateway Artifact Evidence — 2026-07-31

- Environment: development
- AWS account: `362544434697`
- AWS region: `us-east-2`
- Source commit: `92e5b8f17a898c2970a4231c8a8b4e06c988be80`
- Workflow run: [Publish gateway Lambda artifact 30681600862](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30681600862)
- AWS mutation: four immutable release objects written to the existing artifact bucket
- Lambda/API mutation: none

## Release identity

The manual `main`-only publisher built the gateway and its workspace dependencies, passed all 12
gateway tests, passed the dependency audit at High severity, built the Lambda artifact twice, and
proved both builds had the same SHA-256. It then assumed the development GitHub OIDC role and wrote
the following versioned release:

| Field | Value |
|---|---|
| Artifact SHA-256 | `f411b840aec7d631565ecab34e34a164680db49ad64cb2e2b691b3051214560d` |
| Artifact base64 SHA-256 | `9BG4QK7H1jFWXsqzTjShZGgNtJrWTLLitpGzBRIUVg0=` |
| Artifact size | 1,010,811 bytes |
| S3 key | `lambda/gateway/92e5b8f17a898c2970a4231c8a8b4e06c988be80/f411b840aec7d631565ecab34e34a164680db49ad64cb2e2b691b3051214560d/gateway-lambda.zip` |
| S3 object version | `0KxQ8Uil1ZAatXnjljHFWasOCaTTvKov` |

AWS read-back found exactly four current object versions under the source/digest prefix:

- `gateway-lambda.zip`
- `gateway-lambda.cdx.json`
- `gateway-lambda.manifest.json`
- `gateway-lambda.sha256`

The ZIP `head-object` response matched the source and artifact digests in immutable object metadata,
matched the workflow checksum, reported full-object SHA-256 verification, and reported customer-
managed KMS encryption with S3 Bucket Keys enabled. The bucket remained in `us-east-2`, versioning
remained enabled, and all four S3 public-access blocks remained enabled.

## Corrective evidence

The first publication attempt stopped before OIDC and S3 because a clean runner tested the gateway
before building workspace package entrypoints. PR #64 added the missing dependency-graph build
gate. Its quality, integration, static-analysis, dependency-audit, and container checks passed
before merge. The successful run above proves the corrected order on a clean GitHub runner.

## Claims and next gate

This evidence closes the merged-commit artifact-publication gap within SR-002 and supplies the
exact development artifact inputs needed by SR-005. It does not claim a Lambda function, alias,
authorizer attachment, API integration, traffic change, provider-upgrade plan, Terraform apply, or
Fargate retirement. The existing gateway and worker remain on ECS/Fargate.

Next, resolve and review the exact versioned AWS Parameters and Secrets extension layer ARN for
Node.js 24 in `us-east-2`, then generate a refresh-backed provider-upgrade and dark-resource plan
using this exact S3 key, object version, and both artifact digests.
