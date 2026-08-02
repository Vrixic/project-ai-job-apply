# D0-016 development workflow Lambda artifact evidence

- Date: 2026-08-02
- Environment: Development AWS account in `us-east-2`
- Source commit: `673bf991f34f79d0f7cd500ef569be97ce1e0c5c`
- Publication run: [GitHub Actions run 30769223210](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30769223210)
- Status: Passed; artifacts only, with no Lambda deployment, trigger, route, or traffic change

## Publication result

The manual workflow ran from the exact merged `main` commit inside the protected GitHub
`development` Environment. It obtained short-lived AWS credentials through the environment-scoped
OIDC role, verified that the destination bucket is private, versioned, and customer-managed-KMS
encrypted, then built every workflow artifact twice and rejected any digest difference.

Workflow tests and the High-severity dependency audit passed. Each ZIP has a CycloneDX 1.6 SBOM,
manifest, and checksum beside it under a source- and digest-addressed prefix. The publisher checked
that no destination key already existed before writing it.

| Artifact | Exact S3 key | Object version | SHA-256 | Base64 SHA-256 |
|---|---|---|---|---|
| Workflow ingress | `lambda/workflows/673bf991f34f79d0f7cd500ef569be97ce1e0c5c/41635208212a23d7d72178676034112ac8845f9606641a7a1d02ea3e958bfc53/workflow-ingress-lambda.zip` | `tSkdyos1AydQybNxK9xFTgurXWI5Yo4n` | `41635208212a23d7d72178676034112ac8845f9606641a7a1d02ea3e958bfc53` | `QWNSCCEqI9fXIXhnYDQRKsiEX5YGZBp6HQLqPpWL/FM=` |
| Profile-readiness durable | `lambda/workflows/673bf991f34f79d0f7cd500ef569be97ce1e0c5c/35321924d6dd3272488135ffdef82b8ff8cdca29a49623faa14627712160bd64/profile-readiness-durable-lambda.zip` | `wPBaGqW_Xpl4322xD5mvrqHDNetVYdVk` | `35321924d6dd3272488135ffdef82b8ff8cdca29a49623faa14627712160bd64` | `NTIZJNbdMnJIgTX/3vgrj/jNyimkliP6oUYncSFgvWQ=` |
| Profile-readiness activity/terminal | `lambda/workflows/673bf991f34f79d0f7cd500ef569be97ce1e0c5c/cded56496cebe036eddbd7c2514cba42307ba88e7525de93721c8dc74e64c051/profile-readiness-activity-lambda.zip` | `G1ay3LgpVRAbdiYDNFTrMTjdgHMzrMnI` | `cded56496cebe036eddbd7c2514cba42307ba88e7525de93721c8dc74e64c051` | `ze1WSWzr4Dbt29fCUUy6QjB7qI51Jd6TchyNx05kwFE=` |

## Independent AWS read-back

A separate local read-only inspection used the development IAM Identity Center profile after the
workflow completed. For each ZIP it verified:

- exactly one current version exists at the exact key;
- the returned object version matches the table;
- AWS's full-object SHA-256 matches the manifest digest;
- `source-sha` and `artifact-sha256` metadata match the merged commit and ZIP;
- server-side encryption is `aws:kms` with bucket keys enabled; and
- each SBOM, manifest, and checksum key also has exactly one current KMS-encrypted version with
  matching source/digest metadata.

The read-back therefore covers 12 objects: three ZIPs and nine release-evidence objects. It did not
read or print any artifact content, account identifier, bucket name, role ARN, credential, or
candidate data.

## Boundary and next gate

Publication does not create or update Lambda, CloudFormation, IAM, KMS, EventBridge, SQS, VPC
endpoint, API Gateway, ECS, RDS, or Temporal resources. Development continues to route public API
traffic and workflows through the accepted ECS/Temporal rollback path.

The next SR-005 action is a separately reviewed development bootstrap IAM plan. Only after that
exact plan is approved and applied may a refresh-backed dark platform plan be generated from these
three immutable inputs. That dark plan must keep every workflow trigger disabled and keep gateway
dispatch on `temporal`.
