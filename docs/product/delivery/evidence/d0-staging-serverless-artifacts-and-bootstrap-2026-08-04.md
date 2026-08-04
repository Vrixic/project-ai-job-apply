# D0-016 staging serverless artifacts and bootstrap evidence

- Date: 2026-08-04
- Environment: Isolated synthetic staging AWS account in `us-east-2`
- Artifact source commit: `a68f36d5f55521c0221df38d9d1d4c375d88824d`
- Terraform version: `1.9.8`
- Applied-plan SHA-256: `a5d2a553b70ba5d35ffdf7c4c58659888bb1c4bf02f48b854fa3f1315d18c7e2`
- Authorization: Product owner supplied the exact environment, plan purpose, and checksum
- Status: Artifact publication and bootstrap prerequisite accepted; dark runtime deployment remains open

## Protected artifact publication

The staging GitHub Environment was completed with its Terraform-resolved artifact-bucket variable.
The exact current `main` commit then ran the gateway and workflow artifact publishers through the
staging Environment and its short-lived AWS OIDC role:

- [gateway publication run](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30881874730);
- [workflow publication run](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30881876052).

Both publishers passed their High-severity dependency audit, deterministic build, manifest/SBOM,
private-bucket, versioning, encryption, public-access-block, immutable-key, upload, and source
metadata checks. No Lambda function, trigger, API route, ECS service, Temporal path, or traffic
changed.

An independent AWS read-back then verified all sixteen expected objects: four executable ZIPs and
twelve manifest, checksum, and CycloneDX companions. Every key has exactly one current version and
no delete marker. All objects carry the exact source and artifact-digest metadata, use the staging
artifact bucket's customer-managed KMS key with S3 bucket keys, and all four ZIPs expose stored
SHA-256 checksums.

## Guarded bootstrap plan

The development-only workflow-bootstrap planner was replaced with one environment-aware guard plus
a compatibility wrapper. The guard verifies the exact account and region, immutable repository
identity and effective OIDC subject, exact-current-main successful publication, state bucket
versioning/public-access/KMS defaults, and semantic policy deltas.

Staging had not received development's earlier gateway-Lambda IAM bootstrap. The guard therefore
accepted the combined, environment-scoped gateway/workflow delta rather than assuming the newer
development baseline. It proved:

- the GitHub managed permissions boundary and matching inline role policy remain semantically equal;
- the ECS-only pass-role statement is replaced by exact ECS-task/Lambda service scope;
- Lambda deployment resources remain limited to staging functions and the official regional
  Parameters and Secrets extension layer;
- durable-stack and EventBridge permissions remain limited to staging-owned resources;
- runtime VPC-interface, qualified durable-function, and staging queue permissions are exact;
- `kms:GenerateDataKey` remains inside the existing project/environment tag condition; and
- account-wide CloudFormation/EventBridge wildcards are absent.

AWS IAM Access Analyzer returned zero findings for both resulting managed policies. The retained
plan contained only these three in-place updates:

| Action | Count |
|---|---:|
| Create | 0 |
| Update in place | 3 |
| Delete | 0 |
| Replace | 0 |

No trust policy, application runtime, trigger, route, data resource, or traffic resource was in the
plan.

## State-encryption correction and apply

Preflight found the active staging `bootstrap.tfstate` object was private, versioned, and encrypted
with SSE-S3 even though the bucket default is the environment customer-managed KMS key. This is the
same historical Terraform S3-backend behavior already corrected in development: the original
backend used encryption without supplying `kms_key_id`. The July 30 staging evidence's claim that
the active object itself used the CMK was therefore overstated.

The explicit one-time correction mode accepted only that exact SSE-S3 baseline beneath the reviewed
CMK bucket default. The checksum-authorized apply used the corrected backend and completed exactly:

```text
Resources: 0 added, 3 changed, 0 destroyed.
```

The apply rewrote active state. Direct S3 metadata now proves `bootstrap.tfstate` is a non-empty,
versioned, bucket-key-enabled object encrypted with the exact staging customer-managed KMS key. A
fresh refresh-backed Terraform plan reports zero drift.

No account number, bucket name, KMS identifier, role ARN, credential, token, policy body, state
content, saved-plan content, or candidate data is retained in this record.

## Next gate

SR-006 is now in progress. The next step is a separately reviewed staging dark deployment using
these exact immutable artifacts. All SQS/EventBridge workflow triggers must remain disabled and
gateway workflow dispatch must remain on Temporal until dark identity, isolation, workflow,
recovery, observability, alert-delivery, rollback, and zero-drift evidence is accepted.
