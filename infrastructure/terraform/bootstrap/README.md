# Terraform Bootstrap

Creates the encrypted remote-state bucket and GitHub Actions OIDC deployment role in each
environment account. Run this once with an accountable administrator before using an environment
composition. Long-lived AWS access keys must not be stored in GitHub.

The default state and deployment region is `us-east-2`.

Bootstrap starts with local state because its S3 backend does not exist yet. Immediately after the
reviewed bootstrap apply, migrate that state into the newly created environment bucket under
`bootstrap.tfstate`, supplying `bucket`, `key`, `region`, and `kms_key_id` through
`terraform init -migrate-state`. Never commit local state or backend account values.

The GitHub deployment-role trust uses GitHub's immutable OIDC repository subject prefix
(`repo:owner@owner-id/repository@repository-id`) plus the exact GitHub Environment. Verify the
prefix through GitHub's repository OIDC customization API before bootstrapping a renamed,
transferred, or replacement repository; do not weaken the trust to a wildcard subject.
