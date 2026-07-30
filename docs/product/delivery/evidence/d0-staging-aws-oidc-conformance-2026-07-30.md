# D0 Staging AWS OIDC Conformance Evidence — 2026-07-30

## Scope

This record proves GitHub-originated short-lived AWS identity and encrypted bootstrap-state access
for both isolated GitHub Environments. It does not prove the staging persistent platform,
applications, managed runtime secrets, Auth0/Temporal staging configuration, observability,
restore, workload baselines, or Phase 0 completion.

## Source and execution

- Workflow source: merged `main` commit `6616816fbd43cad05805c8b148b2789ecd80ebed`.
- Workflow: [AWS OIDC Conformance](../../../../.github/workflows/aws-oidc-conformance.yml).
- Manual run:
  [30587294343](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30587294343).
- Region: `us-east-2`.
- Authentication: GitHub-issued OIDC tokens exchanged independently for short-lived development
  and staging credentials; no AWS access key was stored in GitHub.

## Results

| Isolated job | Environment variables | Short-lived role | Exact account/role relationship | Encrypted `bootstrap.tfstate` |
|---|---|---|---|---|
| Development identity | Present | Passed | Passed | Reachable |
| Staging identity | Present | Passed | Passed | Reachable |

Both jobs completed successfully. Each job resolved only its selected GitHub Environment's
`AWS_DEPLOY_ROLE_ARN` and `TERRAFORM_STATE_BUCKET`, verified that the runtime STS identity matched
the account and role encoded by that environment's role ARN, and performed a read-only
`HeadObject` against that environment's encrypted bootstrap state.

No account number, role ARN, bucket name, token, credential, or state content is retained in this
evidence.

## Remaining staging acceptance

- The [applications-disabled persistent staging platform](d0-staging-persistent-platform-2026-07-30.md)
  now passes its exact apply, live-control audit, and no-drift checks.
- Configure staging-only Auth0 and Temporal, publish immutable images, migrate, and activate the
  application.
- Replay the applicable identity, ownership, workflow, observability, restart, restore, workload,
  and cost-attribution matrix.
- Record no drift and return staging to its reviewed lean posture when acceptance finishes.
