# D0-016 development workflow dark-conformance failure evidence

- Date: 2026-08-03
- Environment: Development AWS account in `us-east-2`
- Source commit executed: `21f46f2c2233ae4cc47e359b27db8a7624e44482`
- Reviewed context SHA-256: `98d58cad03efdf8a1386a3f0b031e7744833dd5e80d5b262725995f609e5409e`
- Status: Conformance failed safely on the first probe; corrective packaging source is locally verified but not published or deployed

## Execution result

The checksum-gated operator accepted the exact reviewed context, clean source, completed-dark
zero-drift plan, and unchanged live boundary. It then synchronously invoked only the synthetic
profile-readiness activity rejection probe. The function failed during Node.js initialization
before its handler ran, so the operator stopped immediately. The starter, terminal, and durable
probes were not invoked.

Aggregate inspection showed one activity invocation and one activity error. The durable dead-letter
queue remained empty, the SQS event-source mapping remained disabled, the reconciler was not
invoked, and no product-data write, queue send, trigger change, public-route change, ECS-capacity
change, or Terraform apply occurred. The activity error alarm entered `ALARM` as designed and then
recovered to `OK`. The operator revalidated the full live boundary and removed only the exact
checksum-bound local context; cleanup performed no AWS mutation.

## Root cause

The deployed ESM artifact included a CommonJS dependency path that dynamically required a Node.js
built-in module. The Node.js 24 Lambda runtime rejected that dynamic require while importing the
bundle. This is an artifact-packaging defect, not an IAM, KMS, VPC, database, secret, input-contract,
or handler failure.

## Corrective source

The shared workflow Lambda artifact builder now injects a Node-compatible `createRequire` bridge
into ESM bundles. It also imports each completed bundle during the build and verifies every declared
handler export. This makes initialization defects fail the publication build before an artifact can
be uploaded.

All three workflow artifacts now build and import successfully under Node.js 24, including the
starter, reconciler, durable, activity, and terminal exports. This source change is local only. No
corrected artifact has been published, no Lambda version or alias has changed, and the old reviewed
checksum authorizes no retry.

No account identifier, ARN, bucket or object key, credential, token, provider value, raw log, raw
context, candidate data, or product record is retained here.

## Next gate

Merge the packaging correction, publish all three immutable workflow artifacts from exact merged
source, produce and separately authorize a guarded function/version/alias update plan, restore the
seven-alarm completed-dark boundary with zero drift, and generate a new conformance context. A new
explicit checksum authorization is required before any conformance invocation.
