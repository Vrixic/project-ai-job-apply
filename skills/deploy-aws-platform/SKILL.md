---
name: deploy-aws-platform
description: Explain, plan, validate, deploy, verify, or troubleshoot the platform's AWS infrastructure. Use for Terraform bootstrap, GitHub OIDC, remote state, Lambda/API Gateway, durable workflows, the one-off ECS migration task, RDS, queues, S3, KMS, secrets, development or staging rollout, rollback, restore evidence, drift, cost, or cloud status.
---

# Deploy the AWS Platform

## Determine intent and current state

Distinguish an explanation, read-only status check, plan, and authorized deployment. A request to
explain deployment does not authorize applying infrastructure. A direct request to deploy does;
still resolve exact account, environment, state, plan, and images before changing cloud state.

Read:

- `../../infrastructure/terraform/README.md`
- `../../infrastructure/terraform/bootstrap/`
- the selected `../../infrastructure/terraform/environments/<environment>/`
- `../../infrastructure/terraform/modules/platform/`
- `../../.github/workflows/terraform.yml`
- `../../docs/adr/007-isolated-aws-environments.md`
- relevant security documents and runbooks

Verify actual cloud state with read-only commands when credentials are available. Never describe
Terraform files as deployed evidence.

## Enforce prerequisites

- Use separate AWS accounts and state for development and staging.
- Confirm AWS account ID, region, caller identity, target environment, and state key.
- Bootstrap encrypted state and the environment-scoped GitHub OIDC role before environment init.
- Require an approved managed OIDC issuer/audience and scopes; never enable a test-token bypass.
- Use the regional API Gateway HTTPS endpoint initially; require an ACM certificate only when a
  reviewed custom domain is activated.
- Publish gateway and workflow Lambdas as immutable versioned S3 artifacts. Build, scan, and push
  only the one-off database-migration container to its dedicated ECR repository.
- Keep secrets in managed secret stores and out of Terraform values, CLI output, plans, and source.
- Keep `deploy_applications=false` until every application prerequisite validates.
- Preserve the lean defaults until measured demand or launch review justifies replicas, private
  NAT egress, Redis, Multi-AZ data services, an ALB, or continuously provisioned staging.
- Treat ADR-017 and the Temporal/ECS cutover operators as historical evidence. Do not restore the
  retired runtime from current source. Use `serverless_runtime_enabled` as the steady-state public
  route and workflow-trigger kill switch.

Do not run against an ambiguous account or reuse development state for staging.

## Validate and plan

Use Terraform 1.9.8 to match CI:

```powershell
terraform fmt -check -recursive infrastructure/terraform
terraform -chdir=infrastructure/terraform/bootstrap init -backend=false
terraform -chdir=infrastructure/terraform/bootstrap validate
terraform -chdir=infrastructure/terraform/environments/development init -backend=false
terraform -chdir=infrastructure/terraform/environments/development validate
terraform -chdir=infrastructure/terraform/environments/staging init -backend=false
terraform -chdir=infrastructure/terraform/environments/staging validate
```

For a real environment, initialize its configured remote backend, run a refresh-backed plan, save
the plan artifact, review resource replacement/destruction and secret exposure, and apply that
exact reviewed plan. Do not apply a newly regenerated unreviewed plan.

## Roll out and prove

1. Apply bootstrap separately and record outputs securely.
2. Configure GitHub environment variables and OIDC trust with least privilege.
3. Apply persistent data/network resources with applications disabled.
4. Publish immutable Lambda artifacts and the scanned migration-only image after verification.
5. Plan and apply application enablement.
6. Verify API Gateway/Lambda health, OIDC authentication, owner isolation, database migration,
   outbox dispatch, durable completion, logs/traces, queues/DLQ, and alarms.
7. Exercise rollback and restore procedures; retain evidence.
8. Update delivery records only with links to the actual plan, deployment, health, and restore
   evidence.

For provider retirement, require zero unpublished legacy outbox rows, zero running provider
workflows, a successful fail-closed migration, explicit external-key revocation evidence, separate
development/staging Terraform plan checksums, and no deletion of RDS, backups, KMS, artifact
storage, queues, Lambda runtime, or the one-off migration capability.

Stop and report a blocker when credentials, provider configuration, certificate, immutable
images, state, or restore authority is absent. Do not insert placeholder values into live
environments.

## Handle destructive changes

Treat resource replacement, database changes, state moves, key rotation, and destroy operations as
material. Resolve exact targets, explain recovery and downtime, require explicit authorization
when not already unambiguously requested, back up state/data, and prefer staged/reversible
migration. Never use `terraform destroy` as a troubleshooting step.

## Report

State target account/environment, plan/apply identifiers, image digests, migration outcome, health
evidence, rollback readiness, restore result, and remaining blockers. Redact sensitive values.
