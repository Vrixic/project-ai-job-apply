# D1 candidate-rights policy and preprovision remediation — 2026-08-25

## Outcome

The generated-synthetic development policy is selected and immutable, and the repository defects
that prevented safe preprovisioning are corrected. Vercel is not involved. Candidate-rights runtime
activation remains false pending the two-stage AWS rollout, the dedicated non-Zach Auth0 M2M
credential, and one disposable recent-MFA identity.

## Exact policy

- Version: `d1-development-synthetic-v1`
- Artifact: [`candidate-rights.d1-development-synthetic-v1.json`](../../../security/policies/candidate-rights.d1-development-synthetic-v1.json)
- SHA-256: `d9a04c500445c83fe75cc7666f5fc22351431ce4913d81da39abf8aaedd06fff`
- Export artifact: `3600` seconds; exact-version download grant: `300` seconds
- Recent MFA: `900` seconds; defense-in-depth export lifecycle: `1` day
- Backup window: `35` days; recovery markers: Compliance Object Lock through that window and
  lifecycle cleanup after day `36`
- Owners: `identity,profile,documents,jobs,matching,billing`
- Executable subprocessor adapters: `none`; Auth0 remains the separate identity adapter and AWS
  remains the database/object/backup infrastructure boundary
- Identity deletion mode: `delete_user_only` with dedicated Management API scope `delete:users`

The artifact explicitly authorizes generated-synthetic development evidence only. It grants no
real-candidate, public-policy, legal, or accountable security/privacy approval.

## Remediation

- RDS automated-backup retention is now an explicit one-to-35-day Terraform input. Development
  selects `35`; candidate-rights activation fails unless live database policy can cover the exact
  candidate deletion backup window.
- The Auth0 secret container can be provisioned before runtime activation. Terraform owns the exact
  generated-synthetic and non-Zach authorized-owner tags, preventing out-of-band tag drift.
- The recovery-bucket name is shortened below the S3 63-character limit.
- A secure operator helper prompts for the dedicated M2M values, uses only the approved development
  SSO profile, writes an ephemeral CLI request below the user temp directory, deletes it in a
  guarded `finally`, verifies the exact stored schema, and returns hashes only.
- The development acceptance uses the already-implemented Auth0 `delete_user_only` mode because the
  current tenant does not provide the Enterprise-only bulk session/refresh-token endpoints. The
  platform quarantine and anti-resurrection tombstone remain mandatory before provider deletion.

## Verification

- Terraform platform tests: `40` passed, `0` failed.
- Development and staging Terraform validation: passed.
- Candidate-rights acceptance operator: passed in PowerShell 7 and Windows PowerShell 5.1.
- Canonical policy JSON: UTF-8 without BOM, LF-only, one trailing LF, and valid JSON.
- Development IAM Identity Center caller: valid in account `362544434697`, `us-east-2`.

## Live boundary and next action

At inspection, development RDS is available with seven-day automated-backup retention and a current
PITR point. No candidate-rights Auth0 secret, export/recovery bucket, maintenance rule, or NAT exists.
No AWS mutation occurred in this remediation record.

Stage A is a refresh-backed saved plan/apply with candidate rights still disabled: provision the
Terraform-tagged empty secret and raise RDS retention to 35. After the live retention change and
secure M2M population, Stage B enables the generated-synthetic rights runtime and private egress,
then the disposable recent-MFA export/deletion/recovery/alert/zero-drift acceptance runs. No real
candidate identity or data may be used.
