# D0-016 development workflow dark-conformance durable-qualification evidence

- Date: 2026-08-03
- Environment: Development AWS account in `us-east-2`
- Source commit: `fd23fa190a36be5811c3adf8f58fc6d8831f6c1e`
- Authorized context SHA-256: `91a21230ab4852617c31146a550d953a4e03f297c2c28daf2b961ebcdfe5f101`
- Pre-execution zero-drift plan SHA-256: `c6b6bee9fcdd5a233750529ba642d6184e28427c3b1df5172393ab36fbe9d72b`
- Post-execution zero-drift plan SHA-256: `ea362699405fa7c095a5c2d588a96f5358463ed0ffb1683f17998b1873a8f839`
- Status: Three synthetic rejections passed; the durable request was rejected before invocation

## Authorized execution result

The product owner authorized the only fresh context presented after the transport correction
merged. Exact clean `main`, zero drift, immutable aliases, bounded concurrency, disabled triggers,
seven `OK` alarms, an empty durable DLQ, complete durable stack, stable ECS rollback, unchanged API
routing, and Temporal dispatch all passed before execution.

The activity and starter probes each recorded one invocation and zero Lambda errors. The terminal
probe recorded one invocation and its expected rejected-handler Lambda error. The operator then
submitted the durable probe, which AWS rejected with the sanitized service class
`InvalidParameterValueException`; the durable function recorded zero invocations and zero errors.
All four functions recorded zero throttles. No automatic retry was attempted.

Aggregate-only log inspection completed without retaining messages. The bounded window contained
one unclassified `ERROR`, consistent with the expected terminal rejection, plus six unclassified
non-error records and background gateway/worker informational records.

## Containment and cleanup

The checksum-gated cleanup path repeated the full live-boundary validation and removed only the
ignored context without an AWS mutation. The durable DLQ remained empty, all seven alarms remained
enabled and `OK`, the SQS/EventBridge triggers remained disabled, API traffic stayed on ECS, both
rollback services stayed stable, and gateway workflow dispatch remained on Temporal. The exact-main
post-run plan reported zero creates, updates, deletes, or replacements.

No reconciler invocation, SQS send, product-data write, trigger enablement, public-route change,
ECS-capacity change, Terraform apply, or durable execution occurred.

## Root cause and correction

AWS requires durable functions to be invoked through a qualified identifier such as
`function:version`. The operator supplied the unqualified function name and passed the numeric
version through the generic `Qualifier` request parameter. The standard probes accept that form,
but the durable service boundary rejected it before invocation. AWS's
[durable invocation guidance](https://docs.aws.amazon.com/lambda/latest/dg/durable-invoking.html)
shows and requires a qualified function name or ARN.

The operator now constructs `function:version` only for the durable probe and omits the separate
qualifier parameter there. Activity, starter, and terminal targeting is unchanged. Payload
base64 transport, exact execution naming, strict response checks, sanitized errors, and the
no-automatic-retry boundary remain unchanged.

Merge the correction and evidence, synchronize exact clean `main`, regenerate completed-dark zero
drift, and create a fresh reviewed context. A new explicit checksum authorization is required before
execution. Four-probe development conformance, known-good release rollback, and staging remain open.

No account identifier, bucket/object version, KMS identifier, role/function/queue/service ARN,
credential, token, OIDC value, Temporal value, raw payload, raw error/log, state/plan/context content,
or candidate data is retained here.
