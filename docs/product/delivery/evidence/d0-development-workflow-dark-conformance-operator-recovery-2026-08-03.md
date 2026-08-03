# D0-016 development workflow dark-conformance operator recovery evidence

- Date: 2026-08-03
- Environment: Development AWS account in `us-east-2`
- Source commit: `f7fb9b1a8cce8e16540fec4d01c1dd420e8c42d4`
- Authorized context SHA-256: `77069f0c347fa698edc1a444aa41bc9993191df260c2d0a9e36e7b9c47676c30`
- Exact-main zero-drift plan SHA-256: `941638e3cc2ed38738142ec2ad887f49d38e3ad2c80e17467fe2d132322b8660`
- Status: Operator stopped safely after one successful handled activity rejection; correction is local and unmerged

## Authorized execution result

The product owner explicitly authorized the exact checksum-reviewed conformance context. Before
invocation, the operator rechecked clean exact `main`, its own source checksum, the zero-drift plan
checksum, five immutable function aliases, bounded concurrency, disabled event sources, seven
healthy alarms, empty DLQ, complete durable stack, stable ECS rollback services, unchanged API
routing, and Temporal gateway dispatch.

The activity probe synchronously returned the handled `ActivityInputRejected` response without a
Lambda `FunctionError` property. That property is optional and is absent for a handled response.
Because the PowerShell operator runs under strict mode and accessed the missing property directly,
the operator stopped before it evaluated the handled response body. It did not invoke the starter,
terminal, or durable function.

Aggregate CloudWatch metrics for the bounded execution window corroborated:

| Function | Invocations | Lambda errors |
|---|---:|---:|
| Profile-readiness activity | 1 | 0 |
| Outbox starter | 0 | 0 |
| Profile-readiness terminal | 0 | 0 |
| Profile-readiness durable | 0 | 0 |

This is an operator response-parsing defect, not evidence of another artifact initialization or
runtime failure.

## Containment and cleanup

Read-only checks after the stop proved the durable DLQ remained empty, the starter mapping and both
EventBridge rules remained disabled, all seven alarms remained enabled and `OK`, and both ECS
rollback services remained stable. The checksum-gated cleanup action repeated the complete live
boundary check and removed the abandoned ignored context without an AWS mutation.

No reconciler, SQS send, product-data write, trigger enablement, public route change, Terraform
apply, or other workflow invocation occurred.

## Correction and next gate

The operator now resolves optional response properties explicitly. An absent `FunctionError` is
treated as null for handled responses, while the activity error code, starter partial-batch item,
terminal function error/message, durable function error/version/execution identifier, and final
durable execution status are all required through explicit property checks. PowerShell parsing,
optional-property semantics, formatting, and repository checks must pass before publication.

Merge the operator correction and this evidence, synchronize exact clean `main`, regenerate zero
drift, and create a new context with a new checksum. The remaining four-probe execution requires
separate explicit authorization; this partial run must not be represented as conformance success.

No account identifier, bucket/object version, KMS identifier, role/function/queue/service ARN,
credential, token, OIDC value, Temporal value, raw payload, raw log, state/plan/context content, or
candidate data is retained here.
