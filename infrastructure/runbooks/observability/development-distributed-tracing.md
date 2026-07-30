# Development Distributed Tracing

Use this procedure to deploy and prove the Phase 0 trace path in the dedicated development account
in `us-east-2`.

## Reviewed topology

Each existing ECS task contains its application and one non-essential, self-restarting ADOT
collector sidecar:

```text
gateway HTTP span ─┐
                   ├─ OTLP/HTTP on task-local 127.0.0.1:4318 ─ ADOT ─ AWS X-Ray
worker spans ──────┘
```

The gateway stores a valid W3C `traceparent` beside identifier-only outbox data. The dispatcher
continues that context when starting the Temporal workflow, and readiness activities continue it
after Temporal delivery. Temporal history and the database retain only opaque trace context, not
candidate field values.

This does not add an ECS service, replica, load balancer, NAT gateway, or public collector
endpoint. A collector failure does not stop its application container; ECS retries the collector.
The application continues serving if OTLP or X-Ray is unavailable.
The ECS health check must execute `["CMD", "/healthcheck"]`: the digest-pinned minimal collector
image contains the helper binary but no command shell.
The essential gateway container must also execute its direct Node liveness check. A health check
on only the nonessential collector leaves ECS task health unknown, which causes Cloud Map to mark
the gateway instance unhealthy even when both containers are running.

The implementation follows the AWS-supported ECS sidecar pattern and the OpenTelemetry Node SDK
OTLP exporter:

- <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/trace-data.html>
- <https://aws-otel.github.io/docs/setup/ecs/task-definition-for-ecs-fargate/>
- <https://opentelemetry.io/docs/languages/js/exporters/>

## Privacy and security boundary

- Do not capture authorization headers, request/response bodies, candidate attributes, email,
  preferences, resume content, or Temporal/database credentials.
- Do not trace query-bearing HTTP requests; the current API has no query contract, so arbitrary
  query values are outside the telemetry allowlist.
- Use only allowlisted static span names for outbox and activity work.
- Keep correlation IDs in the existing request/audit boundary; put only valid W3C context in
  `outbox_events.traceparent`.
- Use the bounded application role with only `xray:PutTraceSegments` and
  `xray:PutTelemetryRecords`. X-Ray write APIs do not support resource-level scoping.
- Pin the AWS-supported collector by immutable multi-architecture digest.
- Development samples all roots for deterministic evidence. Revisit the ratio before production
  from measured traffic, cost, and incident-debugging needs.

## Preconditions

1. Merge the tracing implementation and require all CI, Semgrep, integration, container, and
   Terraform checks to pass.
2. Refresh `ai-job-apply-development-admin` through IAM Identity Center and confirm it is a
   temporary assumed role.
3. Require Terraform `1.9.8`, remote encrypted state, and a no-drift baseline.
4. Do not print or commit plans, account identifiers, task definitions, trace IDs, provider
   configuration, database values, or tokens.

## 1. Expand the workload boundary

Resolve the existing bootstrap state bucket from encrypted state and set process-scoped bootstrap
inputs. Create a saved refresh-backed plan. It must contain exactly one in-place update:
`aws_iam_policy.workload_boundary`, adding only the two X-Ray write actions above with resource
`*`.

Reject additions, replacements, deletions, trust-policy changes, GitHub-role changes, state/KMS/S3
changes, or any other action. Apply only the reviewed saved plan, remove the local plan artifact,
and require a second refresh-backed no-change plan.

The boundary must be expanded before Terraform creates the application role’s narrower inline
policy.

## 2. Publish immutable application images

After merge, dispatch `Publish development images` from `main`. Require both images to:

- use the merged commit;
- publish immutable index digests;
- contain exactly one `linux/amd64` runtime manifest; and
- complete ECR scanning with zero critical and high findings.

Use the new gateway and worker index digests in the rollout plan. Do not reuse the pre-tracing
images.

## 3. Review and apply the application plan

Reconstruct the exact current application inputs from AWS and encrypted Terraform state, replacing
only the gateway and worker images with the approved new digests. Keep:

- `deploy_applications = true`;
- one gateway and one worker;
- `enable_tracing = true`;
- `trace_sample_ratio = 1`;
- the reviewed immutable ADOT digest;
- Single-AZ PostgreSQL, public task egress, no Redis, no NAT, and no ALB.

The saved plan may only:

- create `aws_iam_role_policy.application_tracing`;
- replace the two ECS task-definition revisions;
- update the two ECS services to those revisions.

Task-definition replacement is expected and must not replace the ECS services or any persistent
resource. Reject changes to RDS, KMS, S3, SQS, Secrets Manager, network resources, API Gateway,
Cloud Map, alarms, desired counts, or provider values. Apply only the exact reviewed plan and then
require no drift with the same inputs.

## 4. Prove the deployed trace

1. Require each service at desired/running/pending `1/1/0`.
2. Require completed primary deployments, one healthy gateway task, one healthy Cloud Map gateway
   registration with IPv4 and port, and one `RUNNING` and `HEALTHY` collector in each task.
3. Use the deployed web conformance client and a synthetic account to save preferences once.
4. Wait until the returned operation reaches `succeeded`.
5. Run:

   ```powershell
   .\scripts\verify-development-tracing.ps1
   ```

The verifier is read-only and emits only aggregate results. It requires one X-Ray trace containing
the gateway root plus `outbox.dispatch`, `profile-readiness.mark-running`, and
`profile-readiness.calculate-and-persist`. It rejects forbidden candidate and credential field
names without printing trace documents or identifiers.

6. Inspect collector log streams in memory and record only counts/statuses. Require no exporter
   errors during the transaction and no forbidden sensitive patterns.
7. Record the merge commit, image digests, plan hashes, plan action counts, service/sidecar states,
   trace-verifier aggregate, UTC interval, and no-drift result in a dated evidence file.

## Failure and rollback

- If the boundary plan is broader than one exact policy update, do not apply.
- If either image scan fails, do not deploy.
- If the collector configuration or task definition is rejected, keep the current services and
  correct the reviewed source.
- If the application revision is unhealthy, perform the existing immutable bad-image rollback.
- If tracing alone is faulty but applications remain healthy, set `enable_tracing = false` only
  through a reviewed emergency plan, preserve the application images, and open a blocking
  observability defect.
- Never roll back by changing RDS, KMS, secrets, queues, networking, migration state, or Terraform
  state.
