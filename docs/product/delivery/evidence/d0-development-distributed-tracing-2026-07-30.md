# D0 Development Distributed Tracing Evidence — 2026-07-30

## Scope

This record covers the deployed privacy-safe trace path for the lean gateway and workflow worker
in the dedicated AWS development environment in `us-east-2`. It proves one synthetic,
authenticated preference transaction across the gateway, transactional outbox, Temporal
workflow, and readiness activities, together with bounded X-Ray permissions, healthy fail-open
collectors, sanitized telemetry, and a refresh-backed no-drift result.

It does not prove provider/log-stream outage recovery, runtime-secret rotation, bad-image
rollback, PostgreSQL restore, on-demand staging acceptance, web recovery/MFA/passkeys,
production readiness, or accountable legal/privacy or security/privacy approval.

No AWS account or infrastructure identifier, trace or task identifier, IP address, Auth0 identity,
preference value, operation identifier, raw trace document, raw log event, token, or secret is
retained in this record.

## Reviewed source and immutable images

The tracing implementation merged in
[PR #22](https://github.com/Vrixic/project-ai-job-apply/pull/22) as
`a725e766e54542492f8661284fde46ee23912cd4`. Repository quality, dependency audit,
PostgreSQL integration, container, Semgrep, and Terraform checks passed.

[Publication run 30512349431](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30512349431)
produced the exact deployed image indexes:

- gateway:
  `sha256:ed6bb1b8cc98f1b6eaf73fbd27c11bfa7391ac559f9e93bb9e96002abeb10327`;
- worker:
  `sha256:6df928a7f018c638724fac2ca08d11f1a958e885d104dcb6110f0cf13cb69e5b`.

Each index contains exactly one `linux/amd64` runtime manifest. Both ECR scans completed with zero
critical and high findings. The collector remained pinned to the reviewed immutable AWS ADOT
multi-architecture digest.

## Reviewed plans and corrective rollouts

The workload-boundary saved plan had SHA-256
`060781CE704D8E8E26A190C7A556454E7E9116FB6547AC42062C9B572EE3F5FA`. It contained exactly one
in-place update that added only `xray:PutTelemetryRecords` and `xray:PutTraceSegments`; it created,
deleted, and replaced nothing. The exact artifact applied successfully and a refresh-backed plan
reported no drift.

The initial application tracing plan had SHA-256
`F96FD781396FB1F9F7EE25246864CB637CD5B8C7732911A8BDEEB2C253E3A9F0`. It created only the narrow
application tracing policy, replaced the two task-definition revisions, and updated the two ECS
services. It did not change RDS, KMS, S3, SQS, Secrets Manager, networking, API Gateway, Cloud Map,
alarms, provider configuration, or desired counts.

The rollout exposed two health-contract defects, and both were corrected without weakening
health enforcement or changing persistent infrastructure:

1. The digest-pinned collector image has no shell but contains a health-check binary.
   [PR #24](https://github.com/Vrixic/project-ai-job-apply/pull/24), merged as
   `f6385814cb62add1d4c175cb70956370b092314f`, replaced the shell command with direct
   `CMD /healthcheck`. The exact two-task-replacement/two-service-update plan had SHA-256
   `0120CDE3D3FD89B0744316F2D75AF46C1BBAFEE5C194BEBD6127DABB06FF1295`.
2. A health check on only the nonessential collector left overall gateway task health unknown,
   causing Cloud Map to reject the otherwise responsive instance.
   [PR #25](https://github.com/Vrixic/project-ai-job-apply/pull/25), merged as
   `8d47191cb3f167c0cc712210422e1c3a9fc42d98`, added the direct essential-container Node liveness
   check. The exact one-task-replacement/one-service-update plan had SHA-256
   `D123AEA80EF2FEC22EA6783D90142A7DE05BBC50B21371B10C61B68A0C7B80BD`.

The X-Ray verifier's first live run then exposed an AWS CLI boolean-flag compatibility defect.
[PR #26](https://github.com/Vrixic/project-ai-job-apply/pull/26), merged as
`e9d7a8b43404ee7c45d618829e2cd74102be8f19`, corrected only the read-only sampling flag. All
remote checks passed. This source-only correction did not change cloud resources.

## Live infrastructure acceptance

Sanitized post-rollout inspection confirmed:

- gateway and workflow worker each report one desired, one running, and zero pending tasks;
- both primary deployments are complete;
- the gateway task and its essential application container report healthy;
- each task contains one running and healthy nonessential collector;
- the application image digests exactly match the reviewed indexes above;
- Cloud Map contains exactly one healthy gateway registration with IPv4 and port;
- `/health/live` and `/health/ready` return HTTP `200`;
- an unauthenticated protected request returns HTTP `401`; and
- the application role contains only the two reviewed X-Ray write actions.

## Authenticated distributed-trace acceptance

The product owner used the deployed web conformance client and a synthetic Auth0 account to save
one ordinary preference, then confirmed the operation reached `succeeded`.

The secret-safe verifier inspected 25 recent traces in memory and reported:

- two services verified;
- two healthy collector sidecars;
- two exact X-Ray write actions;
- one complete trace containing the `gateway` root, `outbox.dispatch`,
  `profile-readiness.mark-running`, and `profile-readiness.calculate-and-persist`;
- zero forbidden candidate or credential field matches.

The transaction-window collector inspection covered
`2026-07-30T05:29:00Z` through `2026-07-30T05:49:00Z`. Both collector streams were quiet during
that window: zero collector log records, therefore zero logged exporter errors, forbidden field
names, email patterns, or JWT patterns. The complete X-Ray trace independently proves that both
collector paths exported the transaction successfully.

A final refresh-backed Terraform `1.9.8` plan reconstructed the exact live images, task sizing,
OIDC, Temporal, database, tracing, and lean-runtime inputs in memory. It returned detailed exit
code `0`, proving no drift after the transaction.

This closes the deployed distributed-tracing substep of D0-006 and D0-011. Phase 0 remains in
progress behind the explicitly recorded identity/provider, bad-image rollback, isolated restore,
on-demand staging, quality/fixture, and accountable approval gates.
