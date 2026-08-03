# D0-016 development source-attested workflow release evidence

- Date: 2026-08-03
- Environment: Development AWS account in `us-east-2`
- Source commit: `281bd9126a2859b854abb2832018d8df1adcb787`
- Publication run: [GitHub Actions run 30849025581](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30849025581)
- Authorized release-plan SHA-256: `429274216a4a75598c9214360d5acf584b01c69ae79e6322b4b31eb60947b029`
- Authorized conformance-context SHA-256: `93c90b472cf11414bfd4211679913c998d1144a34a38aa2f2ce5732f0ed91652`
- Post-conformance zero-drift plan SHA-256: `625a2e406c8b448ef351bf1e07c295f43b0d916715869156582f08ddfa14a8d8`
- Status: Release, dark conformance, and end-to-end notification delivery passed

## Protected publication and independent read-back

The protected development workflow published the three exact-source Lambda ZIPs and their nine
release-evidence companions from the merged commit. Tests, the High-severity dependency audit,
manifest schema `2`, bundle/manifest source attestation, two byte-identical builds, CycloneDX
evidence, short-lived GitHub OIDC, and the private versioned customer-KMS bucket boundary passed.

Independent local read-back rebuilt all three artifacts from the exact clean commit and verified
all 12 remote objects. Each expected key has one unique current object version, no delete marker or
unexpected object exists under the release prefix, source/digest metadata matches, ZIP full-object
checksums and byte counts match, all objects use the required KMS/bucket-key boundary, all remote
manifests retain exact source provenance, and all local matching bundles contain the exact commit
marker. Publication did not deploy a function, move an alias, enable a trigger, or change traffic.

## Authorized release apply

The refresh-backed release plan contained exactly 14 allowlisted updates and one
create-before-delete replacement of the policy-hash-keyed propagation delay. It contained zero
standalone creates or deletes and no API, ECS, trigger, or Temporal-dispatch change. The product
owner authorized the exact checksum, and Terraform applied only that saved file without replanning
or targeting.

The four Terraform-managed workflow functions and aliases, durable stack/version/alias, two
version-scoped role policies, disabled terminal event pattern, queue policy, and Lambda endpoint
policy advanced as one internally consistent release. Immediate completed-dark verification found
zero creates, updates, deletes, or replacements; all five aliases/functions were healthy, all
replacement triggers remained disabled, API/ECS stayed stable, and dispatch remained `temporal`.

## Authorized dark conformance

The product owner authorized the exact synthetic context after its preflight proved zero drift,
five healthy immutable aliases, bounded concurrency, seven enabled `OK` alarms, an empty durable
DLQ, a complete durable stack, stable ECS rollback, disabled triggers, and unchanged public
routing.

All four reviewed probes passed. The activity, starter, and terminal reached their exact invalid
input boundaries; the exact numeric durable version failed closed asynchronously. The operator
observed exactly one matching synthetic DLQ message, proved one `ALARM` and one `OK` transition for
both owned alarms, deleted only the byte-identical reviewed message, restored the DLQ to empty, and
removed its checksum-bound context.

No reconciler, product-data write, product SQS event, trigger enablement, public-route change,
ECS-capacity change, or real outbox workflow occurred.

## Independent post-run evidence

All seven workflow alarms were enabled and `OK`; visible, in-flight, and delayed DLQ depth was zero;
all five aliases selected healthy numeric release versions; and no function throttled. A bounded
aggregate-only log inspection found eight events across the two matching log groups, zero
error-like records, zero unexpected error locations, and zero credential, token, connection-string,
or email patterns. Standard Lambda invocation/error metrics had not populated in that query window,
so their zero datapoints are not used as execution evidence; the operator's direct response,
durable-state, DLQ, and alarm assertions prove the four calls.

The fresh refresh-backed post-run Terraform plan contained zero creates, updates, deletes, or
replacements. The three artifacts and pinned extension revalidated, triggers stayed disabled, API
traffic and ECS capacity did not change, and dispatch remained on Temporal.

The product owner confirmed receipt of all four expected operational notifications: durable-failure
`ALARM`/`OK` and dead-letter `ALARM`/`OK`. No destination or message content is retained.

## Remaining gate

The next SR-005 action is a separately generated and reviewed coordinated reverse Terraform plan
between accepted release sets, followed by rollback behavior, alarm/log, restoration, and
zero-drift evidence. This record does not authorize staging, cutover, or old-runtime retirement.

No account identifier, ARN, bucket/object identifier, KMS identifier, credential, token, OIDC or
Temporal value, raw payload/error/log, Terraform state/plan, conformance context, notification
destination/content, or candidate data is retained here.
