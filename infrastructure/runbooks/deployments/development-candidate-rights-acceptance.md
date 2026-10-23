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
[`d2-development-synthetic-v1`](../../../docs/security/policies/candidate-rights.d2-development-synthetic-v1.json),
SHA-256 `7dbde35dda7542ace2932a68cc8d28618ce14951180f9ab69025b9f511ac35cf`.
Its exact runtime values are export `3600`, download grant `300`, backup retention `35`, recent
authentication `900`, export lifecycle `1`, owners
`identity,profile,documents,jobs,matching,billing,trust`, and executable subprocessor adapters `none`.
This is generated-synthetic engineering policy, not real-candidate or public-policy approval.
For D3, select the existing [D3 synthetic policy](../../../docs/security/policies/candidate-rights.d3-development-synthetic-v1.json)
and its canonical SHA-256, with the exact owner inventory ending in `trust,applications`.
The historical Stage B operator above is D2-specific; it must not be used to certify a D3 rollout.
Review the complete D3 Terraform inputs and plan separately. D3 acceptance requires enabled
private protected-packet export, matching exact Gateway/activity keys and nonempty exported
Applications, packets, approvals, attempts and history. It refuses incomplete coverage before
requesting account deletion. The aggregate receipt binds that coverage and all eight owners.
The existing restricted-answer and generated-resume fixtures remain available for this policy.
For the in-memory session helper, set `ApplicationsInventory: true` in the exact plan options.
This selects the fixed D3 policy/digest and eight owners; it accepts no caller-selected policy,
scope or destination. D2 remains the default. OAuth scopes and memory-only token handling are unchanged.

For D4 (Notifications, [ADR-056](../../../docs/adr/056-notification-email-and-push-delivery.md)), select the
[D4 synthetic policy](../../../docs/security/policies/candidate-rights.d4-development-synthetic-v1.json) with
its canonical SHA-256 and the owner inventory ending in `trust,applications,notifications`. In the session
helper set both `ApplicationsInventory: true` and `NotificationsInventory: true` (Notifications alone is
refused). D4 keeps every D3 gate and the receipt binds nine owners. Before requesting the export, the fixed
fixture saves the disposable candidate's notification preferences and registers one push subscription on an
allow-listed push host through the real candidate API, and the acceptance refuses to delete the account unless
the export lists both. It deliberately does not seed an email address, because confirmation sends mail; the
PostgreSQL tests cover that table. The Gateway and migrations must already serve the Notifications routes.

## Read-only restricted-answer artifact acceptance (D3-029/D3-030)

The opt-in `node scripts/lib/candidate-rights-export.mjs --restricted-answer-acceptance`
mode verifies a generated-synthetic export without making any network call or candidate-data
change. Send its closed JSON envelope on stdin from an in-memory harness, never through command
arguments, a shell transcript, or a committed file. The exact envelope keys are `schemaVersion`
(integer `1`), `expectedExportId`, `expectedPolicyVersion` (fixed D2 or D3 synthetic policy),
`expectedRestrictedAnswers`, and canonical padded `artifactBase64`.

Prepare `expectedRestrictedAnswers` independently from the reviewed synthetic fixture and latest
owner-visible metadata before requesting the export. Never derive the expectation by copying the
artifact being tested. Each entry has the portable schema's exact metadata and, for active entries,
the expected synthetic string value. Include an unexpired active value, an expired active value,
a metadata-only deleted tombstone, and at least one active entry revised to a version greater than
one. All entries must belong to the nine approved value fields and have unique IDs and field/context
references. The exact set and every metadata/value field must match; entry and object-key order do
not matter. Missing or additional entries, superseded versions, changed values/context/expiry,
duplicate references, unknown fields, and a deleted entry carrying plaintext refuse.

Owner approved the additive `createdAt` metadata field on 2026-09-30. The owner-only vault list now
projects the database-generated answer creation time using the export's PostgreSQL JSON timestamp
representation, preserving sub-millisecond precision. It remains stable across correction/deletion.
The shared v1 metadata schema makes this field optional so existing save responses remain unchanged;
the PostgreSQL-backed list always supplies it. This source change is not yet deployed. Require the
field from a compatible deployed owner-list response before preparing the independent snapshot.
Rebuild/deploy the candidate client's strict response validators from the updated contract before
releasing the Gateway producer; old closed-object validators reject the additional field. Existing
lists without the field remain valid for new readers but cannot supply this exact acceptance proof.
Do not infer creation time from the ID, copy it from the tested artifact, seed/read live SQL, or
relax exact comparison. The opt-in fixture integration below requires this compatible deployed list.

Candidate-supplied `confirmedAt` can precede database insertion and its `createdAt` (encryption
happens first), including for a historical answer already expired when saved. Both timestamps
must be no later than artifact generation, and expiry must follow confirmation. Creation is not
required to precede confirmation. Exact expected metadata/value comparison remains unchanged.

Timestamp identity is the exact instant, not a textual ISO/PostgreSQL spelling. The restricted
checker accepts equivalent offsets and fractional padding while retaining every fractional digit
up to nanoseconds (nine digits; PostgreSQL emits at most six). Adjacent microseconds/nanoseconds
remain different, and chronology/expiry checks never round through JavaScript `Date`. Greater
precision refuses. All other metadata and values remain exact; unknown fields still refuse.
The ordinary D2 checker and transport are unchanged. A local generated PostgreSQL regression
prepares expectations from owner-list metadata plus known saved values before querying the export,
then enriches the actual SQL projection through the reader with a fake cipher. This is local SQL
and representation evidence, not live KMS, hosted identity, or guarded account-deletion acceptance.

The artifact remains bounded to 1 MiB, the expected snapshot to 64 KiB and 100 entries, stdin to the
combined envelope bound, and reading to one ten-second total deadline. Success reports only
`valid`, `activeValueCount`, `expiredValueCount`, `deletedTombstoneCount`, and `revisedValueCount`.
Failure reports only the fixed `CandidateRightsExportRejected` code. The ordinary verifier's
stdin shape, bounds, counters and D2 acceptance lifecycle are unchanged.

This mode is an artifact comparison tool, not a deployed acceptance receipt, fixture seeder,
identity/owner-isolation proof, log-redaction scan, or expiry/deletion proof. The existing mutating
acceptance operator now prepares and binds this fixture only when explicitly selected. Fresh disposable
identity/MFA, a compatible immutable Gateway release, reviewed in-memory fixture preparation,
live artifact verification, isolation/failure checks, and cleanup remain required. It supplies no
real-data, API, security/privacy, or production authority.

### Opt-in fixed vault fixture

Select `RestrictedAnswerFixture: true` in the existing process-memory session's plan options, or
`-RestrictedAnswerFixture` on the maintained PowerShell operator. Supply the same selection for
Plan, Execute and later Verify. Omit it for the unchanged historical lifecycle. The selection
requires `profile:read` and `profile:write`, the selected fixed D2/D3 synthetic policy, and matching concrete
vault KMS key ARNs in the immutable Gateway and activity versions; the activity's export flag must
be exactly `enabled`. Rebuild/deploy compatible clients before the approved Gateway metadata
producer, and verify that exact release separately. This operator cannot perform that rollout.

The opt-in plan is schema version 2 with `restrictedAnswerFixture=restricted-answers-v1` and one
additional fixed first step; the old plan stays version 1 with 15 steps. Mode changes, modified
fixture selectors or changed sequence refuse a previously reviewed plan. Plan is still read-only.
Execute first requires an empty vault, including no tombstones, and refuses before writes if any
entry exists. Through the existing candidate API it creates three fixed synthetic boolean answers,
corrects work authorization from true to false, retains an expired sponsorship answer, and deletes
the non-compete answer into a tombstone. No caller-selected fields, contexts or values are admitted.
Every write uses the normal candidate scope; saves carry fresh idempotency keys. This is synthetic
acceptance input, not an inferred answer or permission to fill any application form.

Before export is requested, the latest owner-list response must contain exactly the three expected
IDs/fields/versions/states with creation metadata and the timestamps from those writes. The
independent snapshot combines that metadata with the fixed saved values, kept only in process
memory. The exact downloaded bytes pass both the ordinary D2 checker and the restricted checker;
each restricted coverage counter must be one. Existing nonempty D2 coverage, expiry, cancellation,
recent-MFA recheck, account deletion, completed marker, health and drift gates remain required.
The completed schema-2 receipt and session output add only aggregate `restrictedAnswerCoverage`
and `RestrictedAnswerCoverage`, respectively; no value, row ID, timestamp, subject or artifact is
retained. Verify with the opt-in switch refuses an old receipt or missing/invalid coverage.

On preparation or export refusal, preserve the disposable identity and its generated records for
scoped recovery. Do not restart automatically, overwrite the fixture, silently delete the account,
or turn a failure into acceptance. The normal reviewed deletion lifecycle is the success cleanup.
This addition does not yet implement the parsed-resume case or by-prefix deletion checks (D3-028),
nor a second-identity isolation/failure exercise. Local fake API/native-transport tests do not prove
live KMS, hosted authentication, account deletion or phase completion.

### Opt-in generated resume fixture (D3-028)

Select `ResumeFixture: true` in the process-memory session's plan options, or `-ResumeFixture`
on the maintained PowerShell operator. Keep the selection identical for Plan, Execute and Verify.
The selector binds a schema-3 plan with 17 exact steps, or 18 when combined with the vault fixture.
Historical schema-1 and vault-only schema-2 plans remain unchanged and cannot authorize this case.
The reconstructed live plan compares the hash-only resume runtime identity before execution.

This mode requires `documents:read` and `documents:write`, the reviewed
fixed D2/D3 synthetic policy, an empty disposable owner's resume inventory, and exact
state/Gateway/activity bucket bindings. The Gateway's source KMS key must match the processor.
The processor must use the state-current or a retained earlier immutable numeric version of the
same exact regional parser function, and `resume-parser-v1`. This follows the established
document-processing acceptance boundary: a retained pin is not a reason to release a newer parser.
The actual pinned version's configuration and code hash are checked, and the plan independently
binds current and pinned version ARN hashes. A newer, foreign-function or mutable pin refuses.
The GuardDuty plan must be ACTIVE for only `quarantine/` with tagging ENABLED, and the exact
state scan rule and processor event-source mapping must already be enabled. The harness only
observes these gates; it cannot enable triggers, release code, modify IAM or bypass malware scanning.

Execute generates a fixed 625-byte PDF in memory containing only
`Generated synthetic candidate - Skills: TypeScript`. It registers it through the existing
`POST /v1/resumes/uploads` API, then uploads once using that grant. No arbitrary input file, bucket,
document identifier, direct object deletion, parser invocation or SQL is accepted. The grant must
target the exact regional S3 bucket over HTTPS without redirects, bind the fixed document key,
SHA-256/checksum and KMS key, and expire within the normal five-minute window. Signed fields and
candidate tokens are never printed or retained. Parsing is polled for at most five minutes and
must yield one page and 50 characters; proposals are not confirmed as candidate facts.

Both `quarantine/<document-id>/` and `normalized/<document-id>/` must start empty before upload,
then contain source and normalized versions with no delete markers after parsing. Only after
the existing account-deletion recovery marker reaches completed does the harness list both
prefixes again and require zero versions and zero delete markers. Listings are read-only,
bounded to 1000 entries per prefix and fail closed if truncated, malformed or out of scope.
This is independent prefix verification, not a change to the account-deletion implementation.
It does not cover deliberately seeded older-parser leftovers or explain historical orphan objects
tracked in D3-R8. Failed/ambiguous uploads, parsing or cleanup preserve the disposable scope for
reviewed recovery; no automatic retry, SQL cleanup or direct S3 deletion is performed.

Completed receipts carry only `resumeCoverage`, and the session result only `ResumeCoverage`:
`valid`, `parsedResumes`, source/normalized version counts before and after, and
`deleteMarkersAfter`. No document ID, PDF, normalized text, source key, bucket or signed grant is
stored in that evidence. A historical receipt cannot satisfy Verify with this mode selected.
The ordinary nonempty D2 export coverage, expiry, cancellation, fresh-MFA, owner reconciliation,
Auth0, recovery replay, queue/alert and zero-drift checks are still mandatory. Parsing consumes the
same recent-MFA window; refresh never renews MFA and an expired proof still stops execution.

Local mocked API/S3 observations and production PDF parsing validate the harness, not deployed
deletion. D3-028 and D3-R9 remain open until a reviewed live disposable-account run succeeds.
No real-resume permission under ADR-023 is granted by this synthetic mode.

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
above, the exact nonsecret candidate web client ID as `candidate_rights_id_token_audience`,
`private_application_networking=true`, and `candidate_rights_enabled=true`. Review the NAT, private
routes, two private KMS/versioned buckets, Object Lock, IAM, scheduled maintenance, Lambda
versions/aliases, and absence of durable-data destruction. Apply only that exact plan.

Use the bounded Stage B operator after publishing and independently verifying the gateway artifact
from the same clean merged source. Put the Regular Web App client ID (not the Management API M2M
client ID and not the API audience) in the fixed nonsecret environment variable; never pass it on
the command line:

```powershell
$env:CANDIDATE_RIGHTS_STAGE_B_ID_TOKEN_AUDIENCE = '<exact-candidate-web-client-id>'

pwsh -NoProfile -File scripts/operate-development-candidate-rights-stage-b.ps1 `
  -Action Plan -ExpectedAccountId <development-account-id> `
  -StateBucket <development-state-bucket> -SourceSha <exact-clean-merged-sha> `
  -BaselinePlanPath <fresh-reviewed-zero-drift-plan> `
  -ReviewedBaselineSha256 <reviewed-baseline-sha256> `
  -GatewayReceiptPath <verified-gateway-publication-receipt> `
  -ReviewedGatewayReceiptSha256 <reviewed-receipt-sha256>
```

Independently rehash and review the returned saved plan and adjacent aggregate-only metadata. The
operator requires the baseline's embedded lineage/serial to equal live state, reconstructs every
baseline variable, overlays only the fixed Stage B policy/network/audience and verified gateway ZIP,
requires the state bucket to remain in `us-east-2`, versioned, fully public-blocked and KMS-encrypted,
and validates exactly one `AWSCURRENT` Auth0 value under owner `vrij` with the exact
`clientId`/`clientSecret`/`delete_user_only` schema without emitting or hashing either credential.
It rejects unrecognized address/action sets or any durable deletion/replacement. Apply rechecks the
saved plan's applyable/complete/error status and embedded state identity, never makes a new plan, and
accepts only the unchanged checksummed pair with an exact aggregate-metadata property set:

```powershell
pwsh -NoProfile -File scripts/operate-development-candidate-rights-stage-b.ps1 `
  -Action Apply <the exact account, state, source, baseline, and receipt arguments above> `
  -PlanPath <reviewed-stage-b-plan> -ReviewedPlanSha256 <reviewed-plan-sha256> `
  -PlanMetadataPath <reviewed-stage-b-metadata> `
  -ReviewedPlanMetadataSha256 <reviewed-metadata-sha256>
```

Clear the audience environment variable after use. The operator has no `-auto-approve` path and
never accepts or records the Auth0 M2M secret, candidate tokens, or identity values.

## Non-negotiable prerequisites

Stop before planning unless all of these are independently available:

- clean `main == origin/main`, the exact merged source SHA, Terraform 1.16.2, and an approved
  development IAM Identity Center session in the exact account and `us-east-2`;
- `candidate_rights_enabled=true` in the applied state and the exact reviewed policy version/digest,
  export lifetime, download-grant lifetime, backup retention, recent-authentication age,
  `identity,profile,documents,jobs,matching,billing,trust` owner inventory, and nonempty exact subprocessor
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
- one disposable generated-synthetic Auth0 identity with `profile:write`. The API access token
  supplies only the API authorization context. A separately signed ID token for the same exact
  issuer and subject must have the candidate web client as its sole audience, a current
  `auth_time`, and MFA in `amr`. The identity must contain no real candidate values. Enroll its MFA,
  then reauthenticate through the candidate web route
  `/auth/login?returnTo=%2F&max_age=0&acr_values=http%3A%2F%2Fschemas.openid.net%2Fpape%2Fpolicies%2F2007%2F06%2Fmulti-factor`.
  The acceptance operator intentionally has no identity-creation authority; and
- accountable product/security/privacy ownership of the exact policy and backup inventory. A local
  checksum or repository author is not external approval.

For `Plan` and `Execute`, the operator reads the API token only from
`CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN`, the signed
recent-MFA proof only from `CANDIDATE_RIGHTS_ACCEPTANCE_ID_TOKEN`, and the attestation path only from
`CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_PATH` or its process-memory alternative
`CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_JSON`. Supply exactly one attestation input;
the JSON input is bounded to 8192 UTF-8 bytes and retains the same exact schema and identity checks.
Never place any of these values on the
command line, in shell history, source, a Terraform value, or evidence. The attestation is a
private operator input with this exact schema:

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

Prefer the maintained process-memory handoff below, which writes no attestation file. If using the
legacy path input, keep the attestation outside source and below an operator-controlled encrypted location. The plan
retains only its SHA-256 and the subject SHA-256. Neither token is ever written. Mint a fresh access
token and ID token immediately before `Execute`; the ID-token proof must remain inside the reviewed
recent-auth window after the signed-grant expiry wait. If it becomes stale, execution stops before
creating the final deletion request.

`Execute` additionally requires `CANDIDATE_RIGHTS_ACCEPTANCE_REFRESH_TOKEN` for that same
disposable candidate web session and `CANDIDATE_RIGHTS_ACCEPTANCE_CLIENT_SECRET` for the exact
candidate web application. Supply both through the approved protected, process-local handoff,
never command arguments, shell history or retained evidence. Do not substitute the deletion M2M
client or a reviewer client. The refresh token must be nonblank and client authentication must be
nonblank and at least 16 characters. The operator rejects missing prerequisites before its first
candidate API write and checks them again before refresh. This is presence/shape validation, not
proof that Auth0 will accept the refresh. `Plan` remains read-only and does not need either value.

The fixed sequence renews the access token after the download-grant wait. It retains the original
signed ID token: refresh is not a new MFA transaction and does not renew `auth_time`. Complete the
fresh sign-in close enough to execution for the same ID-token proof to remain valid at the final
check; no stale-MFA bypass or silent identity substitution is permitted.

The installed Node runtime and current repository dependencies must also be ready. Before the
first candidate API write, `Execute` runs the fixed
[`candidate-rights-export.mjs`](../../../scripts/lib/candidate-rights-export.mjs) readiness check,
which compiles the existing domain-owned source schema without requiring a new artifact build.
The export body and expected export/policy bindings are passed to that helper only over bounded
UTF-8 stdin, never command arguments or files. A missing helper/dependency stops before export
creation; invalid downloaded content stops before any deletion request.

For `d2-development-synthetic-v1`, the verified export must also contain at least one consent,
contribution approval, contribution, private capture, Trust case and Trust case event. This is an
acceptance precondition, not a change to the export schema: empty exports remain valid account data.
Missing D2 coverage stops before grant waiting, identity refresh or any deletion request. The created
export remains subject to its configured expiry; prepare the missing disposable data before a new
fresh-MFA/reviewed run. Do not label an empty-account deletion as nonempty Phase 2 acceptance.

The session bridge reports only allowlisted missing counter names with `d2_coverage_missing`;
never forward the raw exception text or export body. An older run that returned only the reason
does not establish which category was empty. Do not infer private-capture absence or replay an
ambiguous save from that generic result. The completed coverage refusal is pre-deletion, not an
ambiguous deletion; any subsequent diagnostic export still requires a new confirmed fresh-MFA
session and separately reviewed plan, and must not claim the old export's missing counts.

## Disposable-account preparation and local sign-in

Prepare the disposable account's nonempty D2 records before fresh MFA. Use the installed extension
under that account for one explicitly selected supported public contribution, its authorization and
normal pending Trust processing. Do not use the owner's main account, an appeal/reviewer identity,
real candidate facts, SQL seeding, or a publication decision merely to make a test fixture. A private
saved-page capture is separately required through the existing owner-scoped API; the current popup
has no private-save button. Applicable revocation/withdrawal history remains part of the acceptance
review. These records must all belong to the same disposable identity later confirmed below.

Do not cancel the sole fixture while it is queued: early cancellation revokes its authorization and
prevents verification/Trust coverage. Let normal processing create the case, then use **Refresh
Trust** and the existing **Withdraw** confirmation. Wait for the owner processing/Trust projections
to settle. Trust withdrawal does not itself revoke Profile consent; the minimum six-counter check
requires consent history, not a claim that both withdrawal and revocation have been exercised.
Do not add another contribution merely to inflate coverage.

The existing compatibility private-save command can be invoked explicitly by the owner from the
extension popup's own developer console, not the provider webpage console or a copied session.
Use the disposable account, reload the configured D2-064 build, revisit a supported public posting,
and press **Inspect current tab**. Review its title/source, keep that tab selected, then open the
popup's **Inspect** developer tools. Only when that exact account/page preparation is authorized,
run this once in the extension context:

```javascript
void chrome.runtime.sendMessage({
  action: "enqueue",
  intent: "private_save",
  approvedFields: ["title"],
}).then((result) => {
  const queue = result?.queue;
  console.log(JSON.stringify({
    ok: result?.ok === true,
    error: typeof result?.error === "string" ? result.error : null,
    privateSaveReason: result?.delivery?.privateSave?.reason ?? null,
    pending: Number.isInteger(queue?.pending) ? queue.pending : null,
    stopped: Number.isInteger(queue?.stopped) ? queue.stopped : null,
    blocked: Number.isInteger(queue?.blocked) ? queue.blocked : null,
  }));
}).catch(() => console.log("Private-capture preparation did not complete."));
```

This selects title only plus required source metadata; the background uses its existing internal
API session and stable retry key. It does not add another public contribution. Do not read storage,
cookies or tokens, paste the complete runtime response, clear existing queues, or rerun after an
ambiguous result. Report only the fixed aggregates. A rejected/stale capture needs inspection, not
a less-trusted sender context; a pending command keeps its existing retry identity. Successful
dispatch and an empty queue are not final persisted-data evidence: the subsequent validated export
must actually contain the private capture. Leave it present until that export/deletion test.
No private-save control is being added back to the product UI.

Keep the popup's developer console open before repeating **Inspect current tab**, then keep the
same provider tab selected. Opening or focusing another window can invalidate the exact tab/URL
binding. The corrected client explicitly selects the last focused normal/browser-popup window,
excluding detached DevTools, for inspection/readiness/enqueue; it still requires the same inspected
tab and URL, with no fallback to a stale capture. Reload the rebuilt extension before using that
fix. Switching to a different browser tab/window or navigating the page still requires inspection.
A status-only `chrome.runtime.sendMessage({ action: "status" })` read can report fixed
readiness reasons and queue counts without enqueueing; omit receipts, capture contents and all
identity/session values from any diagnostic output. Normal status handling can refresh the session
and perform existing local retention housekeeping. `preview_required` means the current inspection
is absent or stale. It does not establish that an earlier failed save stopped before dispatch.
There is no owner capture-list/count route: preserve an ambiguous attempt rather than guessing IDs
or replaying the save. Use validated export coverage to resolve whether a private capture exists;
the nonempty D2 guard stops before deletion if it does not. Report only fixed errors/aggregates.

The maintained handoff replaces historical ignored cookie-extraction helpers. Do not launch an old
browser profile, decrypt a candidate session cookie, reuse an old subject/attestation, or widen client
scopes. Check that existing `frontend/web/.env.local` candidate issuer, client ID and audience match
the deployed Gateway. The helper uses the already registered exact
`http://localhost:3000/auth/callback`; port 3000 must be free. No Auth0/Vercel setting is changed.
The parser accepts one leading UTF-8 BOM from a Windows-written environment file, while retaining
the same strict hostname/client validation. It does not rewrite the file or normalize embedded
markers into valid credential/configuration values.

```powershell
pnpm --filter @ai-job-apply/auth build
node scripts/start-development-candidate-rights-session.mjs
```

Open `http://localhost:3000` yourself. Sign in at Auth0 with the disposable account and fresh MFA.
The no-store local confirmation shows the verified identity privately; provide the authorized owner
name and explicitly confirm generated-only disposable data and permanent-deletion scope. Cancel if
it is the wrong account. Account selection does not create test data, export or delete anything.

The helper cryptographically verifies both JWTs using the shared RS256/JWKS verifiers, checks
nonce/state/S256 PKCE, issuer, candidate-only audience, matching subject, fresh MFA and authorized
party. The existing candidate web scopes are unchanged (they do not include `jobs:contribute`).
No credentials enter arguments, files, browser responses, logs or chat. The short-lived transaction
cookie is the helper's own; it never reads application cookies. After confirmation, the HTTP listener
closes and only the operator's in-memory session remains, until expiry/cancellation/completion.

The operator sends bounded JSON commands over the running process's stdin, not through browser
routes. `plan` accepts only `ExpectedAccountId`, `StateBucket`, `SourceSha`, `ZeroDriftPlanPath` and
`ReviewedZeroDriftPlanSha256` inside `options`; all rights policy/timing values stay fixed above.
The source must be clean merged main and the saved plan must be a current reviewed zero-drift plan
under the ignored development Terraform directory. Review the returned descriptor, then send
`execute` with its exact `reviewedPlanSha256`. There is no automatic execution after sign-in or Plan.
Only one Execute attempt is permitted per session. `{"action":"cancel"}` closes an idle session.
Do not send secrets through stdin: the helper forwards tokens, client secret and exact attestation
only through the directly owned PowerShell child's process environment. It emits only fixed statuses
and validated aggregate results. On ambiguous failure/interruption, inspect the existing recovery
path before any new execution; never blindly retry a potentially confirmed deletion.

The helper does not seed records, manufacture reviewer decisions, create accounts, configure MFA,
approve policy, refresh the MFA proof silently, or replace the existing recovery acceptance evidence.

## Local fail-closed gate

Run the pure operator suite in both supported shells. It makes no AWS, identity, database, Docker,
WSL, Vercel, browser, or GitHub Actions change.

```powershell
pwsh -NoProfile -File scripts/tests/development-candidate-rights-acceptance-operator.tests.ps1
powershell.exe -NoProfile -File scripts/tests/development-candidate-rights-acceptance-operator.tests.ps1
node --test scripts/tests/candidate-rights-export.test.mjs
```

The suite fixes the public parameter surface, policy and owner inventories, generated-synthetic
attestation, recent MFA, non-Zach authority, unweighted artifacts, the 15-step lifecycle, replay
receipt shape, aggregate-only evidence, pre-write refresh prerequisites with zero network calls on
refusal, and prohibited control paths. Generated streams prove the header/body deadline and
disposal on empty, oversized, rejected and stalled downloads. Generated child processes prove
bounded stdin/output, refusal redaction and termination, including a child that stops reading.

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

Create a 15-minute review descriptor only after exporting the three fixed environment variables in
the current PowerShell process:

```powershell
$env:CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN = '<fresh-disposable-token>'
$env:CANDIDATE_RIGHTS_ACCEPTANCE_ID_TOKEN = '<fresh-disposable-id-token>'
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

Reauthenticate the same generated-synthetic identity immediately before execution and supply the
fresh access token, signed recent-MFA ID token, session refresh token and exact web-client
authentication through the fixed process-local inputs above. Preserve the reviewed attestation
and consume the exact reviewed plan. Do not edit or rehash the descriptor. A refresh-token exchange
alone cannot establish fresh MFA.

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
3. validates one exact-version HTTPS signed grant and downloads a nonempty artifact of at most
   1 MiB under a 20-second header-plus-body deadline; validates strict UTF-8 JSON, the existing
   export schema and the exact requested export/policy bindings in memory; discards the body and
   proves the grant no longer returns the object after expiry. The validator child has its own
   30-second whole-operation deadline, at most 8 KiB of fixed aggregate output, and no raw stderr;
4. creates/replays/cancels one deletion request;
5. revalidates the same subject, fresh `auth_time`, MFA, scope, and attestation before making the
   irreversible request;
6. creates and confirms one final deletion request, requiring immediate quarantine;
7. waits for the exact independently encrypted, Object-Locked recovery marker to carry the reviewed
   policy/subject hashes and the durable `completed` tag. Completion is downstream of all seven
   owner deletions, exact export/document-version cleanup, the configured subprocessors, and Auth0
   session/refresh-token/user reconciliation; and
8. repeats empty-queue, healthy-alarm, and zero-compute checks.

The receipt is aggregate only: counts, booleans, source/policy/plan hashes, state identity, timing,
and zero-drift checksum. It contains no token, subject, request/export/operation ID, object key or
version, URL, provider response, identity, user value, or artifact content. A failure or ambiguous
run is not acceptance evidence. Never retry confirmation blindly and never delete or edit a
recovery marker.

`Execute` additionally returns `ExportCoverage` as separate aggregate output, without changing
the persisted lifecycle or historical recovery receipt schemas: `consentCount`,
`contributionApprovalCount`, `contributionCount`, `privateCaptureCount`, `trustCaseCount`, and
`trustCaseEventCount`. The approval count is the required approval record on each exported
contribution, not a separate authorization store. For `d2-development-synthetic-v1`, all existing
D2 export sections must be present. Zero counts remain zero; valid empty sections do not prove
fresh nonempty D2 acceptance.

For that separate D2-020 acceptance, first select a freshly authorized disposable generated-only
candidate and prepare the reviewed nonempty scope through existing candidate/extension commands:
Profile consent history, a contribution with its approval and bounded processing/Trust history,
and a private saved-page capture. Exercise the applicable withdrawal history within that scope.
Do not seed live SQL, borrow a reviewer/real contributor account, publish or decide a case merely
to create test data, or treat a local generated fixture as live evidence. Reauthenticate that same
candidate with MFA immediately before the reviewed lifecycle. Record the actual coverage counts
and any unexercised owner data explicitly; local seven-owner tests and completed historical
restore replay remain separate evidence. No current disposable identity or recent-MFA authority
is established by an old acceptance plan, receipt or encrypted reviewer credential.

## Recovery replay and verification

Formal restore-proof exercises are optional following the owner decision on 2026-10-10.
Encrypted backups, exact target checks and completed-deletion replay before restored traffic remain
required. An optional diagnostic can use and clean a disposable, quiesced, generated-synthetic restore.
The old direct-URL `run-candidate-deletion-recovery-replay` implementation is
retired; use the [guarded isolated replay operator](../restore/candidate-deletion-recovery-replay.md).
Its current schema-bound inspection/replay outputs are not automatically interchangeable with this
historical D1 acceptance packet. Never fabricate this packet from a local unit test, empty cloud
inspection, or replay result whose temporary resources have not actually been cleaned.
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

After checksum review, run `Verify` with the reviewed lifecycle receipt. A recovery receipt and
its checksum are optional; provide both or neither. Omission reports `RecoveryReplayVerified=false`
and a null `RecoveryMarkersValidated`, without claiming a restore check.
It revalidates state identity, live policy/runtime, alarms, queues, and idle compute and reports only
aggregate outcomes. `RecoverCleanup` accepts only an already complete lifecycle receipt and proves
cleanup/health again; it cannot create, confirm, cancel, delete, invoke replay, or convert a failed
run into acceptance.

## Current blockers and nonclaims

At repository implementation time, development candidate rights remain default-off and the exact
accountable policy/timing digest, backup inventory disposition, authorized non-Zach Auth0 M2M
secret/tags, disposable recent-MFA identity, current enabled aliases, zero-drift plan, and isolated
optional restore replay receipt are separate external/runtime inputs. Therefore the operator and pure tests can be
completed locally, but a deployed acceptance run cannot be claimed yet.

A successful run proves one generated-synthetic development lifecycle only. It does not approve
real data, policy values, lawful exclusions, backup expiry, Vercel, browser/accessibility behavior,
staging, production, public launch, independent security/privacy review, or Phase 1 completion.
