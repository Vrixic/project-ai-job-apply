# D0-016 development workflow dark-conformance invocation-mode evidence

- Date: 2026-08-03
- Environment: Development AWS account in `us-east-2`
- Source commit: `1c1bd317b4faac31b351a9531c44ef3e0e17ae85`
- Authorized context SHA-256: `e0add28cfb6db6f563a16b2f295f29da71512314bdba9855a4671505b64a5451`
- Pre-execution zero-drift plan SHA-256: `a0732858661969ecd961322de7105f327b09db44388f1f144ab51d5599cbf636`
- Post-execution zero-drift plan SHA-256: `2bcc27dc3933c9fb24c2042620c732cfd0372214067590e4cfa79c1f12cff91f`
- Status: Contained; durable conformance remains open

## Authorized execution

The merged qualified-target correction and a fresh checksum-authorized context passed exact clean
`main`, zero drift, immutable aliases, bounded concurrency, disabled triggers, seven enabled `OK`
alarms, empty durable DLQ, complete durable stack, stable ECS rollback, unchanged API routing, and
Temporal dispatch.

The activity and starter each recorded one invocation, zero errors, and zero throttles. The terminal
recorded one invocation, its one expected handler-rejection error, and zero throttles. AWS rejected
the qualified durable request before invocation with sanitized class
`InvalidParameterValueException`; it recorded zero invocations, errors, and throttles. No automatic
retry occurred.

Aggregate-only log review retained no messages or identifiers. The bounded window contained the
expected single unclassified error from terminal rejection, six unclassified non-error records,
and routine gateway/worker informational records.

## Containment

Checksum-gated cleanup removed the local context without AWS mutation. The DLQ stayed empty, all
seven alarms stayed enabled and `OK`, triggers stayed disabled, ECS/API/Temporal boundaries stayed
unchanged, and the post-run exact-main plan contained zero creates, updates, deletes, replacements,
or traffic changes. No reconciler, product write, product SQS event, Terraform apply, or durable
execution occurred.

## Corrected root cause

The qualified `function:version` target is required and remains correct, but this authorized retry
proved it was not the complete cause. Both qualified and unqualified-plus-qualifier request forms
passed AWS `DryRun`, while the real qualified synchronous request was still rejected. The deployed
durable configuration has a one-hour execution timeout. AWS documents that durable functions whose
execution timeout exceeds 15 minutes fail immediately when invoked synchronously and must instead
use asynchronous `Event` invocation. See [AWS durable-function best practices](https://aws.amazon.com/blogs/compute/best-practices-for-lambda-durable-functions-using-a-fraud-detection-example/)
and [durable invocation guidance](https://docs.aws.amazon.com/lambda/latest/dg/durable-invoking.html).

The local operator correction retains exact numeric-version targeting but changes only the durable
probe to `Event`. Its checksum-reviewed context discloses one uniquely named invalid execution, one
expected synthetic DLQ message, one byte-exact deletion, and four expected alarm transitions. It
still excludes the reconciler, product writes, product SQS events, trigger enablement, public-route
changes, and infrastructure changes. No corrected probe has been executed; merge, exact-main
zero-drift verification, a fresh checksum, and explicit authorization remain required.

No account identifier, ARN, bucket/object, KMS identifier, credential, token, OIDC or Temporal
value, raw payload/error/log, state/plan/context content, or candidate data is retained here.
