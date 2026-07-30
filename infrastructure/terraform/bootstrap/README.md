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
