# D0 Staging Image Publication Evidence — 2026-07-30

## Scope

This record covers immutable gateway and worker image publication in the dedicated staging AWS
account in `us-east-2`. It proves that images built from the exact merged source revision exist in
the isolated staging registries and that their `linux/amd64` manifests passed the required ECR
severity gates.

It does not prove database migration, application deployment, staging Auth0 or Temporal
configuration, authenticated workflows, observability delivery, rollback, restore, workload
baselines, cost attribution, or Phase 0 completion. Staging applications remained disabled.

## Reviewed source and publication

- [PR #37](https://github.com/Vrixic/project-ai-job-apply/pull/37) generalized the existing
  image-publication workflow for exact `development` or `staging` GitHub Environment selection.
- Repository quality, dependency audit, PostgreSQL integration, three container builds, and
  Semgrep passed before merge. Semgrep initially rejected direct workflow-expression interpolation
  in the scan shell; the workflow moved those values into quoted environment variables, and the
  replacement scan passed without a suppression.
- PR #37 merged as `5a628850c6ac07e66ac8ea197b1c0c50b4941747`.
- [Staging publication run 30592893493](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30592893493)
  ran from that exact `main` revision. Each job independently selected the protected `staging`
  Environment, obtained short-lived AWS credentials through GitHub OIDC, verified its target
  repository was immutable, KMS encrypted, and configured to scan on push, then built and pushed
  only the commit-addressed image.

## Immutable image and scan evidence

| Image | OCI index digest | `linux/amd64` manifest digest | ECR scan |
|---|---|---|---|
| Gateway | `sha256:ec06ddfa2a4b5fe28b48158d0b154d3fe4dc71d54a8d455679dfc02a5fe3a7d8` | `sha256:552f1adf0f64c7ed7f572e0c2c2c983dde5426a87301fd0647c8198640a764bb` | `COMPLETE`; critical 0, high 0 |
| Worker | `sha256:c9a3cc53b2f2f3bec6923033779004366c4f1381d867d9f53488eb154a2dd5f1` | `sha256:783e51f524e8e3da78dcb38c5b6e2edd57d433aefab940941e93340c3099e0e4` | `COMPLETE`; critical 0, high 0 |

After the workflow completed, a separate read-only AWS inspection resolved the exact source tag,
verified exactly one `linux/amd64` manifest per OCI index, and independently confirmed both scan
statuses and severity counts. No mutable release tag is accepted by this evidence.

## Disabled-application verification

The post-publication staging ECS inspection found:

- zero ECS services; and
- zero running ECS tasks.

Image publication therefore did not activate the gateway, worker, migration task, API, or any
candidate-data path. No AWS account number, role ARN, repository URL, registry hostname, task
identifier, secret, token, or raw artifact is retained in this record.

## Remaining staging acceptance

- Create or confirm staging-only Auth0 and Temporal configuration and write the dedicated
  namespace-scoped Temporal key directly into the existing empty managed secret.
- Review and apply the exact migration-task plan using the approved gateway platform digest, then
  run and verify the controlled database migration.
- Review and apply the one-gateway/one-worker application plan.
- Replay identity, ownership isolation, workflow completion, logs/traces/alerts, restart,
  rollback, restore, workload, and cost-attribution evidence.
- Record no drift and return staging to its reviewed lean posture after acceptance.
