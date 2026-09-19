# D3 Applications Development Rollout

- Status: Steps 1-7 and 9 executed in development on 2026-09-18 (evidence on D3-015 in the
  [phase record](../../../docs/product/delivery/phase-3-application-preparation.md)). Steps 8 (deployed
  acceptance) is partially done: read-only synthetic probes passed (403 without scope, store-backed 404, non-allowlisted
  route 404, 401 without a token); the full lifecycle below still needs a real token and a synthetic job. The Auth0
  permissions were reported granted by the owner. Every step ran only through the guarded operators,
  with the saved-plan and reviewer checkpoints those operators define.
- Scope: adds the Applications schema (migration `0001`) and releases a Gateway that composes the
  Applications runtime, in the isolated development account. No staging, no public exposure, no
  real-candidate data, no provider, and no live ATS effect. Live ATS effects stay off (D3-012).
- Companion runbooks: [migration image publication](development-migration-image-publication.md),
  [database migration](database-migration.md), [development gateway release](development-gateway-release.md).

## Why this order

The Gateway Lambda now composes the Applications store and admits the twelve `/v1/applications`
routes. Until the schema exists those calls fail, and until Auth0 issues an `applications:*` scope the
Gateway rejects them (403), so the release is safe either way. Apply the schema first anyway.

## Hard prerequisites (1-4 were satisfied for the 2026-09-18 run; 5 is still open)

1. The reviewed D3 commits are merged to `origin/main`, and the operator shell is on a clean `main`
   exactly equal to it. Every operator, including read-only `Status`, refuses otherwise.
2. Docker Desktop and WSL are running for the image build; stop both afterwards.
3. Temporary IAM Identity Center session for the development account in `us-east-2` (profile
   `ai-job-apply-development-admin`), portable Terraform `1.16.2` (`. ./scripts/use-deployment-terraform.ps1`).
4. A current schema-7 baseline handoff. After the D2-079 deployment, capture a fresh zero-drift baseline
   with `operate-development-gateway-release.ps1 -Action CaptureBaseline`; do not reuse an older sidecar.
   Seed it from the most recent verified zero-drift plan after any shared-state change (for example a D2
   runtime pause or resume): a stale seed is refused by the guard, which is correct.
5. Auth0: add the API permissions `applications:read` and `applications:write` to the development API and
   grant them only to the clients that should call Applications (see the Auth0 runbook). Tokens must also
   carry an existing route-authorizer scope (for example `profile:read`), because the API Gateway `$default`
   JWT authorizer passes a request that has any one listed scope and no Terraform route change is planned.
   Do not add the scopes to the web client's requested scope string until the tenant defines them.

## Sequence and reviewer checkpoints

| # | Action | Operator | Reviewer checkpoint |
|---|---|---|---|
| 1 | Local gate: `LocalBuild` of the migration image | `publish-development-migration-image.ps1 -Action LocalBuild` | none; it contacts no AWS |
| 2 | Publish the migration image, then `Verify` the receipt | same, `Publish` then `Verify` | Independent review of the receipt and its SHA-256; zero High/Critical scan |
| 3 | Capture the current baseline | `operate-development-gateway-release.ps1 -Action CaptureBaseline` | Review the seed and returned plan/sidecar SHA-256 values |
| 4 | Plan and apply the migration task definition | `operate-development-document-migration.ps1 -Action PlanTask` / `ApplyTask` | Review the saved plan: only the one-off migration task definition (and its narrow policy) may change; approve its exact SHA-256 |
| 5 | Plan and run the migration | same, `PlanExecution` / `Execute`, then `Verify` | Approve the execution descriptor; require the eight aggregate success messages, the last being `Applications migrations through 0001_applications_foundation applied and verified.` |
| 6 | Publish and verify the Gateway artifact | `operate-development-gateway-release.ps1 -Action Publish` then `VerifyPublication` | Independent review of the publication receipt |
| 7 | Plan and apply the Gateway release | same, `Plan` / `Apply`, then `Verify` | Approve the saved plan: only `aws_lambda_function.gateway[0]` and its alias may change |
| 8 | Deployed acceptance (below) | [`operate-development-applications-acceptance.ps1`](development-applications-acceptance.md), from a migration image built from the commit that adds it | Review the plan descriptor and the receipt SHA-256 |
| 9 | Stop Docker Desktop and WSL | manual | none |

Never use raw `terraform plan/apply`, the default AWS profile, `-lock=false`, or another CLI version.

## Deployed acceptance (synthetic only)

Use only generated identities and jobs. Prove, with a token that carries `applications:read
applications:write` plus an existing scope:

- `POST /v1/applications` for an active synthetic job returns `201`; a token without the scope returns `403`;
  no token returns `401`.
- Prepare with an observed form binding, approve with the required acknowledgements, and confirm a changed
  posting invalidates approval instead of starting a submission.
- Start, dispatch, and result exercise a synthetic attempt; a second start is `409`; a foreign identity gets `404`.
- The history read ends at `submission_confirmed` and contains no hiring-outcome vocabulary.
- CloudWatch shows no candidate value in the Gateway logs; alarms stay healthy; queues and DLQs are empty.

Do not record account identifiers, the state bucket, or tokens in shared evidence.

## Known limits of this rollout

- Applications is not in the candidate export/deletion inventory. Synthetic candidates deleted through the
  candidate-rights path leave their Applications rows behind (D3-014). Real-candidate use stays blocked.
- The Docker-based Phase 2 recovery harness (`pnpm test:d2-recovery`) still asserts the six-owner boundary and
  was not updated or run.
- There is no outbox publisher, stale-attempt recovery schedule, or alarm for Applications yet.
- The web BFF routes and extension integration do not exist, so no browser flow reaches these routes.

## Rollback

- Before step 4: nothing changed.
- After step 5 (schema applied): the migration is additive and forward-only; leave it in place. Disable use by
  removing the Auth0 grant for `applications:*` or by rolling the Gateway back.
- Gateway: use a separately generated and checksum-reviewed Terraform plan that restores the previously accepted
  immutable Gateway artifact, then repeat verification, as the gateway release runbook requires.
