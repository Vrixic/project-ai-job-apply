# D1 candidate-rights policy and preprovision remediation — 2026-08-25

## Outcome

The generated-synthetic development policy is selected and immutable, the repository defects that
prevented safe preprovisioning are corrected, and Stage A is applied. Vercel is not involved.
Candidate-rights runtime activation remains false pending the dedicated non-Zach Auth0 M2M
credential, one disposable recent-MFA identity, and the separately reviewed Stage B rollout.

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

## Recent-MFA proof correction

The expanded local correction separates API authorization from reauthentication proof. The API
access token remains the authorization credential and must grant `profile:write`. Every
candidate-rights mutation requires a separate Auth0 ID token: export create, deletion-request
create, deletion-request cancel, and deletion-request confirm. The ID token supplies only
recent-authentication evidence. It is accepted only after RS256 signature/JWKS verification;
required `exp`, `iat`, and `auth_time`; exact issuer verification; the candidate web client ID as
its sole audience; a nonempty subject matching the access-token subject; and a bounded, nonempty
`amr`. All four mutations apply the 900-second recency boundary. Confirmation alone additionally
requires `amr` to contain the literal `mfa` value.

OpenAPI places the required, 32-to-16,384-byte compact-JWT
`X-AI-Job-Apply-Reauthentication` header directly on exactly four mutation operations:
`createCandidateDataExport`, `createAccountDeletionRequest`, `cancelAccountDeletionRequest`, and
`confirmAccountDeletionRequest`. It is not a global security scheme and is not required on the
status or exact-version download-grant reads. The same-origin BFF obtains both tokens from the
server-held Auth0 session and forwards the ID token only on those four mutations; browser code does
not receive either token.

The Lambda edge allowlist now admits all exact candidate-rights route shapes that the Nest gateway
already implements: export create/status, deletion request create/status/cancel, and confirmation.
It rejects malformed identifiers, wrong UUID versions/casing, trailing slashes, and wrong methods,
while preserving the private proof header. Shared structured-logger redaction covers the
reauthentication header under both `req.headers` and `request.headers` so its value cannot enter the
normal application log boundary.

The acceptance operator consumes separate access-token and ID-token inputs, checks their exact
issuer/subject/audience binding and distinct roles, includes only an audience hash in its descriptor,
and retains neither token. Stage B must bind `candidate_rights_id_token_audience` to the exact
candidate web client ID. A new guarded Stage B operator creates a saved plan only from a current
refresh-backed baseline and a separately verified gateway receipt. It validates exact state
lineage/serial, the Stage B variable transition, state-bucket controls, one exact managed secret
version without emitting or hashing its credential, and an explicit address/action allowlist with
no durable deletion or replacement. Apply consumes only the independently checksummed saved plan
and aggregate-only metadata; it never regenerates a plan or accepts `-auto-approve`.

The candidate reauthentication link requests `max_age=0` and the multi-factor `acr_values`, but the
Auth0 tenant must still configure and validate a post-login step-up Action plus an enabled factor
that actually honors that request. The query parameter alone is not proof of step-up. All behavior
in this section is source-level validation only, not an Auth0 configuration or Stage B result.

## Verification

- Auth package: `11` tests passed.
- Gateway package: `122` tests passed.
- Candidate web package: `529` tests passed.
- Targeted auth, gateway, and candidate-web typechecks: passed.
- Terraform platform tests: `42` passed, `0` failed.
- Development and staging Terraform validation: passed.
- Candidate-rights acceptance operator: passed in PowerShell 7 and Windows PowerShell 5.1.
- Candidate-rights Stage B operator: `33` tests passed in PowerShell 7 and `33` passed in Windows
  PowerShell 5.1.
- Canonical policy JSON: UTF-8 without BOM, LF-only, one trailing LF, and valid JSON.
- Development IAM Identity Center caller: valid in account `362544434697`, `us-east-2`.

## Live boundary and next action

Stage A was applied from exact source `a012b7c1fca1afec677f73ceae8093b731992a9d` using reviewed
saved-plan SHA-256 `12a6eff65bd9d71f315f01255ccd0932bd345900345b7867459a943e4fe429b5`.
Terraform reported one addition, one change, and no destruction, advancing development state to
serial `204`. Development RDS is available with 35-day automated-backup retention, no pending
modification, and a current PITR point. The candidate-rights Auth0 secret container exists with
`ai-job-apply:generated-synthetic-only=true` and `ai-job-apply:authorized-owner=vrij`; it has zero
secret versions and therefore contains no credential. Candidate-rights activation remains false,
and no export/recovery bucket, maintenance rule, or private-egress activation exists.

The post-apply refresh-backed plan has zero meaningful changes. Its ignored saved-plan path is
`infrastructure/terraform/environments/development/.terraform/development-candidate-rights-release/stage-a-zero-drift-a012b7c1fca1-state204.tfplan`
and its SHA-256 is `7a632ab215f3675649ed7127223c6e4f90db19476778b41bdcd32467a8032317`.

The remaining non-Vercel sequence is:

1. Create a dedicated non-Zach Auth0 M2M client with only `delete:users`.
2. Populate the preprovisioned secret through the secure helper.
3. Configure and validate the Auth0 post-login step-up Action and enabled factor so the candidate
   reauthentication request's multi-factor `acr_values` is honored rather than ignored.
4. Create and MFA-enroll one disposable generated-synthetic identity, then reauthenticate through
   the candidate web session so it supplies a fresh access token and separately bound ID token.
5. Use the guarded Stage B operator to generate a saved plan with the exact candidate web client ID
   as `candidate_rights_id_token_audience`; independently review and checksum the plan and metadata,
   then apply only those exact files to enable the generated-synthetic rights runtime and private
   egress.
6. Run the export/deletion/recovery/alert/zero-drift acceptance and preserve aggregate-only evidence.

No Auth0 client, M2M credential or secret version, disposable identity, Stage B plan/apply, Lambda
release, or deployed candidate-rights acceptance is claimed. No real candidate identity or data may
be used.
