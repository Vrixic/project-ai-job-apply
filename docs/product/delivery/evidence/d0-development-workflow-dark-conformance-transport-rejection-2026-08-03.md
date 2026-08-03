# D0-016 development workflow dark-conformance transport-rejection evidence

- Date: 2026-08-03
- Environment: Development AWS account in `us-east-2`
- Source commit: `04694a432a1e0b91e5b8f2279d95c394b79f2c50`
- Authorized context SHA-256: `c6b083f3a7ce8f1d44f24de9f0ca4e5d4b2b9081248a764e650e916b3529b15d`
- Exact-main zero-drift plan SHA-256: `a6b175cd23c0a033d746ce2cf9184da68523cc5193832ebf78b64dee1881f360`
- Status: Invocation transport rejected before an observed Lambda invocation; corrected operator is local and unmerged

## Authorized execution result

The product owner explicitly authorized the new context generated from the merged optional-response
parser. Exact clean `main`, operator/context/zero-drift checksums, five immutable aliases, bounded
concurrency, disabled triggers, alarms, DLQ, durable stack, API/ECS rollback, and Temporal dispatch
all passed before execution.

The AWS CLI returned a nonzero result while submitting a reviewed synchronous invocation. The
operator deliberately retained no raw CLI output and its existing sanitized message did not identify
the probe or failure class. Aggregate Lambda metrics for the execution window showed zero activity,
starter, terminal, and durable invocations and zero Lambda errors. The activity function remained
active, successfully updated, reserved at one concurrency, and unthrottled. The development IAM
Identity Center session remained valid.

Because no invocation was observed, this event does not test or contradict the corrected artifact's
handled activity response. No automatic retry was attempted: an ambiguous request must not create
an unreviewed fifth invocation or duplicate a request whose delivery is uncertain.

## Containment and cleanup

The durable DLQ remained empty and the reviewed context checksum remained unchanged. The
checksum-gated cleanup path repeated the complete live-boundary validation and removed only the
ignored local context without an AWS mutation. No reconciler, SQS send, product-data write, trigger
enablement, route change, Terraform apply, or observed workflow Lambda invocation occurred.

## Correction and next gate

The operator now encodes every reviewed UTF-8 payload as base64 before passing the Lambda blob
parameter, eliminating shell/CLI JSON quoting from the transport boundary. It also labels each probe
and maps raw CLI text to a narrow sanitized error class such as an AWS service code, expired session,
credentials, payload, arguments, or network failure; raw errors remain undisclosed. It does not add
automatic retries.

Merge this correction and evidence, synchronize exact clean `main`, regenerate zero drift, and
create a new checksum-reviewed context. Execution again requires explicit authorization. Development
dark conformance, logs/alarms acceptance, and known-good release rollback remain open.

No account identifier, bucket/object version, KMS identifier, role/function/queue/service ARN,
credential, token, OIDC value, Temporal value, raw payload, raw error/log, state/plan/context content,
or candidate data is retained here.
