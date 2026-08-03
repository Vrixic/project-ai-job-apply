# D0-016 development workflow rollback-release preflight evidence

- Date: 2026-08-03
- Environment: Development AWS account in `us-east-2`
- Inspected source commit: `a97322b3e94b6c6daa403f012f307e67d684e0ed`
- Status: Source preparation passed locally; publication, deployment, conformance, and rollback are
  not performed

## Safe rollback-target finding

A read-only inventory inspected all five deployed workflow Lambda functions and their environment
aliases. Every alias targets immutable version `2`, and each function retains only version `1` as
the prior numeric version. Version `1` belongs to the pre-correction artifact set that failed during
Node.js 24 module initialization. It is therefore not a known-good rollback target and was
deliberately rejected.

No alias, function, trigger, route, ECS service, Temporal path, Terraform state, or other AWS
resource changed during this inspection. No account identifier, function ARN, credential, token,
provider response, or candidate data was retained.

## Source-attested release preparation

The shared workflow Lambda artifact builder now emits manifest schema `2` with an exact
`sourceSha` and embeds the same provenance marker in the executable bundle. Local builds explicitly
use `local`; a committed provenance value is accepted only when it is a lowercase 40-character Git
commit matching the exact clean checkout. The protected publication workflow binds this value to
`github.sha`, validates both the manifest and bundle marker, then performs its existing second-build
reproducibility and CycloneDX checks before publication.

This creates a behavior-neutral but byte-distinct second accepted release after merge, publication,
deployment, and conformance. It avoids relabeling the known-bad version as rollback-ready and makes
the source boundary independently auditable.

## Local verification

- Two complete `@ai-job-apply/workflows` Lambda builds produced byte-identical ZIPs.
- All three manifests report schema `2` and `sourceSha: local`.
- All three ZIP bundles contain the `applydash-artifact-source:local` marker.
- A dirty checkout attempting to claim the current commit was rejected before artifact creation.
- The serverless workflow infrastructure-policy validator passed the protected-publication
  provenance assertions.
- The High-severity dependency audit initially detected newly disclosed vulnerable `fast-uri`
  transitive releases. Exact patched replacements (`3.1.5` and `4.1.2`) were locked, installed,
  and the repeated audit reported no known vulnerabilities.
- The full repository skills, infrastructure, formatting, lint, type-check, and test gate passed.

## Remaining authorization gates

This source change does not publish or deploy an artifact and does not prove rollback. After merge:

1. Publish all three source-attested artifacts from the exact protected `main` commit.
2. Independently read back the immutable objects and provenance evidence.
3. Generate and separately authorize the exact development release plan.
4. Deploy the second release without enabling triggers or changing API/ECS/Temporal routing.
5. Repeat development dark conformance and accept the new release.
6. Generate a separate reverse Terraform plan between the two accepted release sets, obtain its
   exact checksum authorization, execute it, verify behavior and alarms, restore the newer release,
   and prove zero drift.

The existing single-alias gateway rollback operator is not reused because the workflow release is
coupled across five aliases plus IAM, EventBridge, and durable-version references.
