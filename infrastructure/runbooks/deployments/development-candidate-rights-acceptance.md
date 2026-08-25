# Development candidate-rights generated-synthetic acceptance

Use this runbook only after candidate rights are deliberately enabled in development with an exact
accountable policy, current immutable runtime, completed owner migrations, and a newly authorized
Auth0 Management API client. It proves one disposable generated-synthetic export/deletion lifecycle.
It does not approve policy values, legal exclusions, real-candidate use, public activation, staging,
or production.

The guarded operator is
[`scripts/operate-development-candidate-rights-acceptance.ps1`](../../../scripts/operate-development-candidate-rights-acceptance.ps1).
Its normal mutation action is `Execute`. `Status`, `Plan`, `RecoverCleanup`, and `Verify` are
read-only with respect to application data and AWS resources. No action can enable candidate rights,
move a Lambda alias, apply Terraform, run an ECS task, create an Auth0 identity, or accept a caller-
selected route, payload, SQL, command, role, bucket, function, secret, subject, or token.

The selected generated-synthetic policy is
[`d1-development-synthetic-v1`](../../../docs/security/policies/candidate-rights.d1-development-synthetic-v1.json),
SHA-256 `d9a04c500445c83fe75cc7666f5fc22351431ce4913d81da39abf8aaedd06fff`.
Its exact runtime values are export `3600`, download grant `300`, backup retention `35`, recent
authentication `900`, export lifecycle `1`, owners
`identity,profile,documents,jobs,matching,billing`, and executable subprocessor adapters `none`.
This is generated-synthetic engineering policy, not real-candidate or public-policy approval.

## Two-stage infrastructure and credential setup

Provision the tagged managed secret and raise RDS retention before runtime activation. Keep
`candidate_rights_enabled=false`, set `candidate_rights_auth0_secret_provisioned=true`, set
`candidate_rights_auth0_authorized_owner` to the exact approved non-Zach operator identifier, and
set `database_backup_retention_days=35`. Review and apply one refresh-backed saved plan with no
destroy or replacement of durable data. Wait until RDS reports an available instance with live
retention `35`; a pending modification is not acceptance.

In the Auth0 dashboard, an MFA-protected non-Zach administrator creates a dedicated Machine to
Machine application for the tenant Management API and grants only `delete:users`. Do not reuse the
candidate web client or any dashboard administrator identity as the disposable candidate. Populate
the Terraform-managed container from a private interactive terminal; the helper never accepts the
secret on its command line and emits hashes only:

```powershell
pwsh -NoProfile -File scripts/configure-development-candidate-rights-auth0.ps1 `
  -ExpectedAccountId <development-account-id> `
  -AuthorizedOwner <exact-non-Zach-owner>
```

After exact secret validation, prepare a second refresh-backed saved plan with the policy values
above, `private_application_networking=true`, and `candidate_rights_enabled=true`. Review the NAT,
private routes, two private KMS/versioned buckets, Object Lock, IAM, scheduled maintenance, Lambda
versions/aliases, and absence of durable-data destruction. Apply only that exact plan.

## Non-negotiable prerequisites

Stop before planning unless all of these are independently available:

- clean `main == origin/main`, the exact merged source SHA, Terraform 1.9.8, and an approved
  development IAM Identity Center session in the exact account and `us-east-2`;
- `candidate_rights_enabled=true` in the applied state and the exact reviewed policy version/digest,
  export lifetime, download-grant lifetime, backup retention, recent-authentication age,
  `identity,profile,documents,jobs,matching,billing` owner inventory, and nonempty exact subprocessor
  inventory;
- one fresh checksum-reviewed, refresh-backed Terraform plan with zero meaningful changes;
- an available RDS instance whose automated-backup retention covers the reviewed candidate-rights
  backup window, plus an exact current snapshot inventory. Elapsed time never substitutes for the
  inventory check or proves `backup_expired`;
- unweighted numeric versions for gateway, outbox starter, Profile durable, activity, and terminal
  aliases, with exact immutable code hashes and the reviewed policy environment on the activity;
- every state-managed queue empty, every development alarm enabled and `OK`, and zero active ECS
  tasks;
- the candidate-rights Auth0 secret tagged
  `ai-job-apply:generated-synthetic-only=true` and
  `ai-job-apply:authorized-owner=<approved-non-Zach-owner>`. Its exact secret JSON is
  `clientId`, `clientSecret`, and
  `revocationMode=delete_user_only`. The dedicated Auth0 M2M client receives only `delete:users`.
  This generated-synthetic development mode is compatible with the current tenant and relies on
  the platform's immediate quarantine/tombstone for authorization denial before provider deletion.
  Do not use Zach Becker's identity, an IAM user, or a shared client. The stronger
  `revoke_sessions_refresh_tokens_then_delete` mode remains a future launch option only after an
  eligible Auth0 plan and separate accountable review;
- one disposable generated-synthetic Auth0 identity with `profile:write`, a current `auth_time`, and
  MFA in `amr`. The identity must contain no real candidate values. Create it through the separately
  reviewed identity procedure; the acceptance operator intentionally has no identity-creation
  authority; and
- accountable product/security/privacy ownership of the exact policy and backup inventory. A local
  checksum or repository author is not external approval.

The operator reads the token only from
`CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN` and the attestation path only from
`CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_PATH`. Never place either value on the command
line, in shell history, source, a Terraform value, or evidence. The attestation is a private
operator input with this exact schema:

```json
{
  "schemaVersion": 1,
  "classification": "generated-synthetic-only",
  "issuer": "https://managed-issuer.example/",
  "subjectSha256": "<sha256-of-exact-subject>",
  "authorizedOwner": "<approved-non-Zach-owner>",
  "createdAt": "<canonical-current-UTC-time>",
  "expiresAt": "<canonical-future-UTC-time>"
}
```

Keep the attestation outside source and below an operator-controlled encrypted location. The plan
retains only its SHA-256 and the subject SHA-256. The access token is never written. Mint a fresh
recent-MFA token immediately before `Execute`; it must remain inside the reviewed recent-auth window
after the signed-grant expiry wait. If it becomes stale, execution stops before creating the final
deletion request.

## Local fail-closed gate

Run the pure operator suite in both supported shells. It makes no AWS, identity, database, Docker,
WSL, Vercel, browser, or GitHub Actions change.

```powershell
pwsh -NoProfile -File scripts/tests/development-candidate-rights-acceptance-operator.tests.ps1
powershell.exe -NoProfile -File scripts/tests/development-candidate-rights-acceptance-operator.tests.ps1
```

The suite fixes the public parameter surface, policy and owner inventories, generated-synthetic
attestation, recent MFA, non-Zach authority, unweighted artifacts, the 15-step lifecycle, replay
receipt shape, aggregate-only evidence, and prohibited control paths.

## Status and plan

First confirm the live account, encrypted state, candidate-rights resources, policy, backup
inventory, exact aliases, authorized Auth0 secret, queues, alarms, and idle compute. Pass the same
exact policy arguments shown for `Plan`; omitted values deliberately fail closed.

```powershell
pwsh -NoProfile -File scripts/operate-development-candidate-rights-acceptance.ps1 `
  -Action Status `
  -ExpectedAccountId <development-account-id> `
  -StateBucket <development-state-bucket> `
  -ExpectedPolicyVersion <reviewed-version> `
  -ReviewedPolicySha256 <reviewed-policy-sha256> `
  -ExpectedExportLifetimeSeconds <reviewed-seconds> `
  -ExpectedDownloadGrantSeconds <reviewed-seconds> `
  -ExpectedBackupRetentionDays <reviewed-days> `
  -ExpectedRecentAuthMaxAgeSeconds <reviewed-seconds> `
  -ExpectedSubprocessorInventory <exact-reviewed-csv>
```

Create a 15-minute review descriptor only after exporting the two fixed environment variables in
the current PowerShell process:

```powershell
$env:CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN = '<fresh-disposable-token>'
$env:CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_PATH = '<private-attestation-path>'

pwsh -NoProfile -File scripts/operate-development-candidate-rights-acceptance.ps1 `
  -Action Plan `
  -ExpectedAccountId <development-account-id> `
  -StateBucket <development-state-bucket> `
  -SourceSha <exact-clean-merged-sha> `
  -ExpectedPolicyVersion <reviewed-version> `
  -ReviewedPolicySha256 <reviewed-policy-sha256> `
  -ExpectedExportLifetimeSeconds <reviewed-seconds> `
  -ExpectedDownloadGrantSeconds <reviewed-seconds> `
  -ExpectedBackupRetentionDays <reviewed-days> `
  -ExpectedRecentAuthMaxAgeSeconds <reviewed-seconds> `
  -ExpectedSubprocessorInventory <exact-reviewed-csv> `
  -ZeroDriftPlanPath <reviewed-zero-drift-plan> `
  -ReviewedZeroDriftPlanSha256 <reviewed-plan-sha256>
```

An independent reviewer rehashes the plan below the ignored
`.terraform/development-candidate-rights-acceptance` directory. Review its exact source/state,
policy/timing/inventory, subject/attestation hashes, Auth0 client/owner hashes and revocation mode,
backup inventory hash/count/retention, five unweighted alias versions/code hashes, queue/alarm/idle
compute counts, zero-drift checksum, expiry, and exact 15-step sequence. The descriptor must contain
no token, subject, owner name, secret, account ID, bucket, ARN, URL, identity value, or exported data.

## Execute once

Mint or refresh the same generated-synthetic identity's recent-MFA token immediately before
execution, update only the fixed token environment variable, and consume the exact reviewed plan.
Do not edit or rehash the descriptor.

```powershell
pwsh -NoProfile -File scripts/operate-development-candidate-rights-acceptance.ps1 `
  -Action Execute `
  <the exact account, state, source, policy, timing, inventory, and zero-drift arguments above> `
  -ExecutionPlanPath <reviewed-plan-path> `
  -ReviewedExecutionPlanSha256 <reviewed-plan-sha256>
```

The fixed sequence does the following:

1. creates one portable export and proves exact idempotent replay;
2. polls only bounded status until ready;
3. validates one exact-version HTTPS signed grant, streams and discards at most 1 MiB of the
   generated-synthetic artifact, and proves the grant no longer returns the object after expiry;
4. creates/replays/cancels one deletion request;
5. revalidates the same subject, fresh `auth_time`, MFA, scope, and attestation before making the
   irreversible request;
6. creates and confirms one final deletion request, requiring immediate quarantine;
7. waits for the exact independently encrypted, Object-Locked recovery marker to carry the reviewed
   policy/subject hashes and the durable `completed` tag. Completion is downstream of all five
   owner deletions, exact export/document-version cleanup, the configured subprocessors, and Auth0
   session/refresh-token/user reconciliation; and
8. repeats empty-queue, healthy-alarm, and zero-compute checks.

The receipt is aggregate only: counts, booleans, source/policy/plan hashes, state identity, timing,
and zero-drift checksum. It contains no token, subject, request/export/operation ID, object key or
version, URL, provider response, identity, user value, or artifact content. A failure or ambiguous
run is not acceptance evidence. Never retry confirmation blindly and never delete or edit a
recovery marker.

## Recovery replay and verification

Account deletion is not restore-safe until the independent marker replay runs against a disposable,
quiesced, generated-synthetic development restore. Use the existing restore procedure to create and
clean that restore; invoke `run-candidate-deletion-recovery-replay` only with
`RESTORED_DATABASE_IS_QUIESCED_AND_NOT_SERVING_TRAFFIC`; never point it at the primary database.
Retain a separately reviewed aggregate receipt with exactly:

```json
{
  "schemaVersion": 1,
  "kind": "development-candidate-deletion-recovery-replay",
  "environment": "development",
  "sourceSha": "<exact-source-sha>",
  "policySha256": "<reviewed-policy-sha256>",
  "restoredDatabaseClass": "disposable-quiesced-generated-synthetic",
  "markersValidated": 1,
  "restoredUsersAbsent": 0,
  "restoredUsersReconciled": 1,
  "primaryDatabaseRejected": true,
  "trafficEnabled": false,
  "cleanupSucceeded": true,
  "completedAt": "<canonical-UTC-time>"
}
```

`markersValidated` may be greater than one, and absent plus reconciled must equal it. The receipt
must not contain restored identifiers, database endpoints, marker keys, decrypted locators, owner
values, row values, or artifact content.

After independent checksum review, run `Verify` with the reviewed lifecycle and recovery receipts.
It revalidates state identity, live policy/runtime, alarms, queues, and idle compute and reports only
aggregate outcomes. `RecoverCleanup` accepts only an already complete lifecycle receipt and proves
cleanup/health again; it cannot create, confirm, cancel, delete, invoke replay, or convert a failed
run into acceptance.

## Current blockers and nonclaims

At repository implementation time, development candidate rights remain default-off and the exact
accountable policy/timing digest, backup inventory disposition, authorized non-Zach Auth0 M2M
secret/tags, disposable recent-MFA identity, current enabled aliases, zero-drift plan, and isolated
restore replay receipt are external/runtime inputs. Therefore the operator and pure tests can be
completed locally, but a deployed acceptance run cannot be claimed yet.

A successful run proves one generated-synthetic development lifecycle only. It does not approve
real data, policy values, lawful exclusions, backup expiry, Vercel, browser/accessibility behavior,
staging, production, public launch, independent security/privacy review, or Phase 1 completion.
