# Development Applications Lifecycle Acceptance

- Status: Implemented and locally verified 2026-09-18; **not yet executed against the deployed development account.**
- Operator: `scripts/operate-development-applications-acceptance.ps1` (guard tests in
  `scripts/tests/development-applications-acceptance-operator.tests.ps1`).
- In-image fixture: `applications/dist/src/run-lifecycle-acceptance.js` in the migration image.
- Companion runbooks: [D3 Applications rollout](d3-applications-development-rollout.md),
  [migration image publication](development-migration-image-publication.md),
  [development Gateway release](development-gateway-release.md).

## What it proves

It drives the deployed Gateway version through the full Applications lifecycle as a generated owner and
a generated foreign candidate, then removes everything it created. Twenty-four fixed steps:

1. A token without an Applications scope, and one with read but not write, are refused (403).
2. A create is accepted (201) and an identical replay returns the same application (idempotency).
3. A foreign candidate cannot read, prepare, or read the history of the application (404).
4. A packet is prepared with a form binding and reviewed; approval with a wrong packet hash is refused
   (409), and the exact hash is approved.
5. A submission attempt with a changed form invalidates approval instead of starting (the application
   returns to review), then the packet is prepared and approved again.
6. One submission starts; a second start is refused (409); dispatch is recorded and a repeated dispatch is
   refused (409).
7. A timeout result makes the outcome ambiguous and requires reconciliation; a blind restart is refused
   (409); the candidate attests the submission and the application becomes `applied`.
8. The technical history ends at `submission_confirmed`, contains no hiring-outcome vocabulary, and a
   start after `applied` is refused (409).
9. The final application is one candidate-attested confirmed attempt, and a reused idempotency key with a
   different body is refused (409, `idempotency_conflict`).

Every expected status was first proven against the real Gateway and schema by the database-gated test
"follows the exact statuses the deployed acceptance operator expects" in `backend/gateway/src/app.test.ts`.

## Boundaries (read before running)

- **Generated-synthetic only.** Both identities are created by the reviewed fixture with run-scoped
  subjects, and a foreign identity never owns data. No real candidate, resume, or profile fact is used.
- **The catalog job is referenced, never changed.** Plan selects one existing active job with a read-only
  search (no user is created by job routes). Because the job is not mutated, the "changed posting
  invalidates approval" case is covered by the local integration tests, not by this deployed run; the
  changed-form case is proven here instead.
- **No provider confirmation is ever claimed.** No adapter exists and no live application effect is
  possible. `applied` is reached only through a generated candidate attestation.
- **Not a real-token test.** It calls the exact deployed Lambda version with an authorizer context; it does
  not prove that Auth0 issues the `applications:*` scopes or that API Gateway's authorizer accepts them.
  Prove that separately with a real sign-in (see the Auth0 runbook and the web README flags).
- **Not approval.** It is not the D3-012 accountable security/privacy approval.
- **Cleanup is exact or the run fails.** Cleanup uses the privacy-authorized deletion function for the owner,
  then removes the two identities, and refuses to run if any other row references either identity.
  Verification never calls the Gateway afterwards, because a request for a removed identity would create
  a new one.

## Prerequisites

1. The commit that adds this operator is merged; the operator shell is a clean `main` equal to
   `origin/main`.
2. A migration image published and verified **from that commit** (it carries Applications migration
   `0002_candidate_rights` and the fixture), the migration task definition applied, and the migration run
   through `Verify` so the development database has `0002`. Follow the
   [rollout runbook](d3-applications-development-rollout.md) steps 2-5 for the new commit.
3. The Gateway alias is the exact reviewed version (the operator binds its artifact SHA-256 and numeric
   version) and the development database is healthy with no active migration task.
4. Docker is not required. IAM Identity Center session for `ai-job-apply-development-admin`;
   pinned Terraform (`. ./scripts/use-deployment-terraform.ps1`).

## Run

```powershell
. ./scripts/use-deployment-terraform.ps1
.\scripts\operate-development-applications-acceptance.ps1 -Action Status -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET
.\scripts\operate-development-applications-acceptance.ps1 -Action Plan `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
  -MigrationReceiptPath RECEIPT -ReviewedMigrationReceiptSha256 RECEIPT_SHA256 `
  -ExpectedGatewayArtifactSha256 GATEWAY_ARTIFACT_SHA256 -ExpectedGatewayVersion GATEWAY_VERSION
```

Review the descriptor (job id, generated identities, the two fixed run-task requests) and its SHA-256, then
run `Execute` within 15 minutes with the same release inputs plus `-ExecutionPlanPath` and
`-ReviewedExecutionPlanSha256`. Review the returned receipt SHA-256, then run `Verify` (read-only) with
`-ReceiptPath` and `-ReviewedReceiptSha256`. If Execute reports that cleanup was not proven, run only
`RecoverCleanup` with the retained receipt.

## Recorded exceptions

- On 2026-09-18 read-only probes of `GET /v1/applications/{id}` with a synthetic subject
  (`synthetic-applications-acceptance`) resolved that subject on first use and left one generated identity
  (a user, an external identity, and an `identity.linked` audit event) in the development database. It holds
  no Applications data. It predates this operator and is not removed by it; remove it through a reviewed
  action or the candidate-rights deletion path once the D3 policy is activated.
