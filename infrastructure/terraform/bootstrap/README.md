# Terraform Bootstrap

Creates the encrypted remote-state bucket and GitHub Actions OIDC deployment role in each
environment account. Run this once with an accountable administrator before using an environment
composition. Long-lived AWS access keys must not be stored in GitHub.

The default state and deployment region is `us-east-2`.

Bootstrap starts in an isolated local-backend workspace because its S3 backend does not exist yet.
Create that workspace with:

```powershell
.\scripts\prepare-terraform-bootstrap.ps1 -Environment staging
```

The helper copies the resource configuration and lock file outside the repository, but replaces
the committed partial S3 backend declaration with `versions.local.tf.example`. This prevents a
development backend initialization or local state from being reused for staging.

Generate, review, and apply the exact saved plan from that workspace. Immediately after the
reviewed bootstrap apply, replace the workspace's `versions.tf` with this directory's committed
`versions.tf` and migrate the local state into the newly created environment bucket under
`bootstrap.tfstate`, supplying `bucket`, `key`, `region`, and `kms_key_id` through
`terraform init -migrate-state`. Verify the encrypted remote object before removing any local
recovery copy. Never commit local state, plans, workspace paths, or backend account values.

The GitHub deployment-role trust uses GitHub's immutable OIDC repository subject prefix
(`repo:owner@owner-id/repository@repository-id`) plus the exact GitHub Environment. Verify the
prefix through GitHub's repository OIDC customization API before bootstrapping a renamed,
transferred, or replacement repository; do not weaken the trust to a wildcard subject.

The deployment boundary also permits same-account AWS Budgets and CUR 2.0 Data Export management.
Apply bootstrap-policy changes from an isolated environment-specific bootstrap workspace before
expecting the GitHub deployment role to plan or apply new billing controls.

The workload boundary permits `rds-db:connect` only for the exact database username
`ai_job_apply_public_job_reader`; the environment platform policy further narrows that maximum to
its exact RDS resource ID. A separately reviewed bootstrap apply must land this boundary revision
before any anonymous public-job route can be enabled. This source packet neither applies bootstrap
nor activates public traffic.

## Original resume download route

Optional `route = { hosted_zone_id, base_host }` must agree between the preparation release and
bootstrap `native_resume_control_releases` for the original revision. Bootstrap supplies a
principal-bound durable DNS ceiling; the preparation module grants exact-zone CREATE/DELETE A
records under the original host plus zone inspection/change status. The shared boundary gains
no DNS capability. Route runtime and creation switches default false and are independent of
new task launches. Keep lifecycle enabled for original cleanup when creation stops. The durable
execution budget is 2,400 seconds; encrypted checkpoint retention remains seven days.

Prepare bootstrap first and use a new original release; retain old roles/versions/configuration
until drain. This does not migrate an existing role boundary or enable retained numeric versions.
Network reachability, matching TLS/ingress, terminal reconciliation and live download acceptance
remain required. Local mocked Terraform checks are not effective managed IAM evidence.

## Native application preparation

`native_preparation_releases` defaults empty. Each explicit original release ID provisions one
principal-conditioned boundary shared by five preparation roles. Common logging/configuration,
private SQL access, packet cryptography, exact launcher invocation, original durable dispatch,
metadata-only recovery and queue nudges each name only their appropriate original roles.
Ordinary deployment can read/use these exact ceilings and manage the original durable stack;
it cannot update or replace the boundary. Keep original releases until verified drain.

Use the same release ID, exact same-account/environment secret, numeric launcher, distinct packet
keys and queue/key IDs as the native application preparation module. Apply bootstrap separately
before runtime planning. Tests cover original-role isolation and coexistence with a retained
resume/DNS release under IAM's 6,144-character managed-policy limit. A precondition rejects
oversized combined deployment policies; never delete undrained releases to satisfy it. Empty
input preserves the original deployment-policy representation and authority. Effective AWS IAM,
key/queue resource policies and managed release acceptance still require separate verification.

## Native material launcher

`native_material_control_releases` defaults empty. Each retained release ID creates the exact
`material-launch-${release_id}-boundary` used by native material control. Every statement names
only its original launcher principal, exact task/cluster, database/configuration key and two
original task roles. No task stopping, content storage or Lambda invocation is allowed by the
ceiling. Deployment can read/use the approved boundary but cannot modify it. Match the release
ID, task revision and bindings to the control/task modules; retain original authority until drain.
Sixteen bootstrap mock scenarios pass, including combined resume/DNS, preparation and material
control under IAM's policy-size limit. This does not prove effective managed IAM.
