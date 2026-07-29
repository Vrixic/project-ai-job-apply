# Terraform Bootstrap

Creates the encrypted remote-state bucket and GitHub Actions OIDC deployment role in each
environment account. Run this once with an accountable administrator before using an environment
composition. Long-lived AWS access keys must not be stored in GitHub.

The default state and deployment region is `us-east-2`.

Bootstrap starts with local state because its S3 backend does not exist yet. Immediately after the
reviewed bootstrap apply, migrate that state into the newly created environment bucket under
`bootstrap.tfstate`, supplying `bucket`, `key`, `region`, and `kms_key_id` through
`terraform init -migrate-state`. Never commit local state or backend account values.
