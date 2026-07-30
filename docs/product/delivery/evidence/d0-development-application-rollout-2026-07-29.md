# D0 Development Application Rollout Evidence — 2026-07-29

## Scope

This record covers the first gateway and worker rollout into the dedicated AWS development
environment in `us-east-2`. It proves that the lean application topology is deployed, stable,
drift free, and connected to its managed PostgreSQL and Temporal dependencies. It also records the
failed first attempt and application-only rollback rather than hiding the failure.

It does not prove a valid Auth0 user transaction through the deployed gateway, owner isolation and
durable workflow completion in AWS, alert delivery, image-revision rollback, PostgreSQL restore,
on-demand staging rehearsal, web recovery/MFA/passkeys, or Phase 0 completion.

## Reviewed source and remote checks

- The Cloud Map service-discovery correction and application rollout/rollback procedure were
  reviewed in [PR #15](https://github.com/Vrixic/project-ai-job-apply/pull/15), merged as
  `4b633e06fde8cc5e48aa399f36d60687b0531fb7`.
- Repository quality, dependency audit, PostgreSQL integration, container builds, Semgrep, and
  Terraform validation passed in
  [CI run 30501977604](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30501977604),
  [static-analysis run 30501977599](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30501977599),
  and [Terraform run 30501977620](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30501977620).
- The deployed tasks use the previously approved, fully scanned `linux/amd64` image manifests:
  gateway `sha256:978453c8dd813494c42617d6cc890660a14625261b82ad3d59e88296d6bd8277`
  and worker `sha256:085e6d18c9d8d712bb961ac9d532674ded6faf442c19b26eeb4bae2198e03ce2`.
  Both ECR scans completed with zero critical, high, medium, or low findings.

## First attempt and controlled rollback

The initial application-enable plan had SHA-256
`0C072E3A99A333AAE0730C1361F31BA1F85B7535A6333EE9C378224C4F4410E1`. Review confirmed
11 creates, no updates, replacements, or deletions, one task per service, exact immutable image
digests, and no changes to the persistent layer.

AWS rejected gateway service creation because the initial Cloud Map `A` record registration did
not accept the ECS container port required by the API Gateway private integration. The worker
reached its expected one desired/one running/zero pending state, but the incomplete rollout was not
accepted.

The rollback plan had SHA-256
`667D50F76041DF211CBA5AD4EDF39822879FF5EA27781AEB413754BD3B109AF2`. Review confirmed
exactly ten application-only deletions and no persistent-layer change. Applying it returned the
environment to zero ECS services, zero platform API Gateway APIs, and zero platform Cloud Map
namespaces; the subsequent refresh-backed Terraform plan reported no drift.

PR #15 changed service discovery from an `A` record to an `SRV` record and registered gateway
container port `4000`, matching the API Gateway and ECS service-discovery contract.

## Successful reviewed plan and apply

Terraform `1.9.8` ran through the temporary development IAM Identity Center profile. Caller,
account, region, encrypted remote state, Auth0 public discovery/JWKS, managed Temporal secret,
database TLS, and clean image-scan prerequisites passed without recording environment identifiers
or secret material.

The corrected application-enable plan had SHA-256
`456785A4B46938E9B01FDB391FC440AF7EF42ECBB225564A82BD523F216521D9`.
Review confirmed:

- 11 creates and no updates, replacements, or deletions;
- a regional HTTP API, VPC Link, default route, integration, and stage;
- an `SRV` Cloud Map namespace/service registration with container port `4000`;
- one gateway and one worker ECS task using the approved immutable manifests;
- `linux/amd64`, `awsvpc`, and one desired task per service; and
- the accepted lean flags: no Redis, NAT gateway, load balancer, high availability, or container
  insights.

The exact saved plan applied successfully with 11 resources added, zero changed, and zero
destroyed. A refresh-backed plan with the identical inputs then reported no changes. The local
saved plan was deleted after its hash and result were recorded.

## Live acceptance

Sanitized live inspection established:

- exactly two ECS services exist;
- gateway and worker each report one desired, one running, and zero pending tasks;
- both services run their approved image digests with the expected architecture and network mode;
- Cloud Map reports a healthy gateway instance with its registered port;
- gateway `/health/live` returns HTTP `200`;
- gateway `/health/ready` returns HTTP `200`, proving its PostgreSQL dependency is ready;
- gateway `/v1/me` without a token returns HTTP `401`;
- a deliberately invalid in-memory JWT returns HTTP `401`, with no token or provider detail in the
  response or logs;
- encrypted gateway logs contain the expected startup event;
- encrypted worker logs contain the expected Temporal-connected startup event; and
- application log groups use KMS encryption and 30-day retention, with no detected secret/token
  patterns in the inspected events.

No gateway URL, cloud-account identifier, ARN, network identifier, task identifier, IP address,
tenant host, raw token, secret, or raw log payload is retained in this record.

## Remaining acceptance

- Send a valid development Auth0 web session through the deployed gateway and prove candidate
  identity mapping, owner isolation, preference persistence, outbox dispatch, Temporal completion,
  and the observable result.
- Prove alert delivery, broader deployed telemetry/tracing, provider/log-stream behavior, and
  runtime-secret rotation.
- Exercise an approved bad-image revision rollback and an isolated PostgreSQL restore.
- Rehearse the isolated staging environment on demand.
- Complete web recovery/MFA/passkey evidence and accountable legal/privacy and security/privacy
  approvals.
