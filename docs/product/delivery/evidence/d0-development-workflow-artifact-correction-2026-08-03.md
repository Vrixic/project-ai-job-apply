# D0-016 corrected development workflow Lambda artifact evidence

- Date: 2026-08-03
- Environment: Development AWS account in `us-east-2`
- Source commit: `f207bc01d73505244b5e96b8c1005e622953d4f5`
- Publication run: [GitHub Actions run 30786236433](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30786236433)
- Status: Passed; corrected immutable artifacts published without deployment or trigger changes

## Publication result

The protected development publication workflow ran from the exact merged commit containing the
Node.js 24 ESM/CommonJS packaging correction. Workflow tests, the High-severity dependency audit,
and two complete artifact builds passed. Both builds produced identical digests and imported each
bundle to verify the starter, reconciler, durable, activity, and terminal handler exports before
publication.

The workflow obtained short-lived AWS credentials through GitHub OIDC, revalidated the private,
versioned, customer-managed-KMS artifact bucket, rejected pre-existing destination keys, and
published each ZIP with its CycloneDX 1.6 SBOM, manifest, and checksum companion.

| Artifact | Exact S3 key | Object version | SHA-256 | Base64 SHA-256 |
|---|---|---|---|---|
| Workflow ingress | `lambda/workflows/f207bc01d73505244b5e96b8c1005e622953d4f5/117025562481a47c45ec059a1df761c4169bde93410eca06a7c873877f1f9ebc/workflow-ingress-lambda.zip` | `04ehYDgXuB0C_dfrTv2IP9j8BpFuWfF.` | `117025562481a47c45ec059a1df761c4169bde93410eca06a7c873877f1f9ebc` | `EXAlViSBpHxF7AWaHfdhxBab3pNBDsoGp8hzh38fnrw=` |
| Profile-readiness durable | `lambda/workflows/f207bc01d73505244b5e96b8c1005e622953d4f5/69332006dba844afc550e9f663be3d2a3490c5fb599f3e5e7825f94ed313bb5a/profile-readiness-durable-lambda.zip` | `_iCerCDTDl8ton0KpuDUGn5tWt12xLUF` | `69332006dba844afc550e9f663be3d2a3490c5fb599f3e5e7825f94ed313bb5a` | `aTMgBtuoRK/FUOn2Y749KjSQxftZnz5eeCX5TtMTu1o=` |
| Profile-readiness activity/terminal | `lambda/workflows/f207bc01d73505244b5e96b8c1005e622953d4f5/2ad7dd7eeef1a1d478fc7e1639ec15dc16e595ff6fca28fec78d44be75e43b29/profile-readiness-activity-lambda.zip` | `SSLiYCQJ2pM5Ng8CK3TdhAO5kZZQrsIU` | `2ad7dd7eeef1a1d478fc7e1639ec15dc16e595ff6fca28fec78d44be75e43b29` | `Ktfdfu7xodR4/H4WOewV3Bbllf9vyij+x41EvnXkOyk=` |

## Independent AWS read-back

A separate local read-only inspection used the development IAM Identity Center profile after the
workflow completed. It verified all 12 new objects: three ZIPs plus nine SBOM, manifest, and
checksum companions. Every exact key has one current object version, source/digest metadata matches
the merged commit and artifact, every object uses `aws:kms` with bucket keys enabled, and each ZIP's
AWS full-object checksum matches its published Base64 SHA-256.

The inspection did not download artifact content or retain an account identifier, bucket name,
role or key ARN, credential, token, raw provider output, or candidate data.

## Boundary and next gate

This publication created immutable S3 objects only. It did not update a Lambda function, publish a
Lambda version, move an alias, enable an SQS/EventBridge trigger, change API routing, change ECS or
Temporal dispatch, or apply Terraform.

The next SR-005 action is a refresh-backed development function/version/alias update plan using
these exact object versions and digests. That plan must remain separate from apply, preserve every
dark trigger and the public ECS/Temporal rollback path, reject unrelated change, and receive an
explicit checksum authorization before execution.
