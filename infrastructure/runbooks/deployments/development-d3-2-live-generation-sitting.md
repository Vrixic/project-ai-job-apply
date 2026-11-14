# D3.2 live generation sitting (development)

Plan for turning on live resume tailoring and live cover letters in the development account, proving
them, and shutting the environment down again. Decisions are in
[ADR-059](../../../docs/adr/059-live-generation-through-amazon-bedrock.md); the task register is
[D3.2](../../../docs/product/delivery/phase-3-2-live-ai-generation.md). Everything it needs is built and
merged and dark; nothing here has been run. Items marked *inferred* come from reading source and were
not tested; confirm them in the saved plan before applying.

Roles follow the earlier releases: the agent prepares inputs, builds, saved plans and evidence; the owner
signs in (SSO, MFA) and runs every `-Execute` apply and the sign-in for the live journey. Review each
saved plan against the previous one (resource addresses, counts, no unexpected deletes) before the owner
applies it. A rejected or stale plan is never reused; use a new plan name.

## 0. Before the sitting

| Need | Why |
|---|---|
| Anthropic use case form submitted for the account (owner), or an explicit yes for the agent to submit it with the owner's values | Without it every Sonnet 4.6 call answers "Model use case details have not been submitted" (a definite refusal, shown as a failed state, but no live proof) |
| `aws sso login --profile ai-job-apply-development-admin` just before each long step | The token expires within a couple of hours |
| Docker running; portable Terraform 1.16.2 (`scripts\use-deployment-terraform.ps1` in the same pwsh process); PowerShell 7 | Image build and the operators |
| Clean `main` equal to `origin/main` | The publishers refuse anything else |

Already decided, for the record:

- **Web consent.** The web cover-letter step sends the notice version with `acknowledged: true` and shows no
  notice. That is the owner's decision in [ADR-050](../../../docs/adr/050-generate-then-apply-flow.md): consent is
  presented in the sign-up terms or privacy policy, and it is an open D6 privacy-review item. The Terms and the
  [subprocessor list](../../../docs/security/subprocessors.md) must name AWS Bedrock and Anthropic's Claude as
  `COVER_LETTER_DISCLOSURE_TEXT` does, before any real candidate. Nothing to change in the page for the sitting.

Decide before the first apply:

1. **Which control flags are baked into pinned Lambda versions** (*inferred*). The control Lambdas publish a
   numeric version with their flags as environment, and the image and the preparation release pin those
   numbers. The resume releases flipped launch, schedule and route flags after the image was pinned (r3d), so
   those are safe to flip later. Read the saved plan: if a flag flip creates a new owner or launcher version,
   decide the final `owner_enabled`, `control_enabled` and `recovery_enabled` before the image is built.
2. **First revision numbers.** Bootstrap tfvars already carry control `r1` (task revision 1, launcher
   `material-launch-r1:1`) and preparation `r1`. The repo cannot prove the `native-material` task family has no
   earlier revision; check `aws ecs list-task-definitions --family-prefix ai-job-apply-development-native-material`
   first, and use the next real revision.
3. **Budget service name.** Start with `Claude Sonnet 4.6 (Amazon Bedrock Edition)` and confirm it with
   `aws ce get-dimension-values --search-string Claude` once billing data exists (up to a day after the first
   calls); a wrong name tracks nothing. The kill switch, not the budget, is the hard stop.

## 1. Restore and migrate

1. Restore dark from the latest dormant inputs (final snapshot `ai-job-apply-development-shutdown-20261113191602`)
   with the reactivation steps in [database dormancy](development-database-dormancy.md); then bring up
   endpoints, NAT and runtime. Keep ingestion off. The restore verifier compares the ledger with the migration
   image's manifest, so verify the restore with the migration image that is already published (90 migrations),
   then release the new one (*inferred* from `restore-verifier.ts`; this is how migration 0020 and 0021 went).
2. Publish a migration image from `main` (91 migrations, Applications `0016_cover_letter_bedrock_notice`;
   `scripts/publish-development-migration-image.ps1`, [publication](development-migration-image-publication.md))
   and run it with `scripts/operate-development-document-migration.ps1` (PlanTask, ApplyTask, PlanExecution,
   Execute, Verify). Expect "Applications migrations through 0016_cover_letter_bedrock_notice applied and
   verified" and a zero-drift plan. The Gateway insert relies on the new column defaults, so this precedes any
   Gateway or preparation release. Documents needs no migration (ADR-059 addendum 13). The restore manifest
   is 7,692 of 7,700 gzip characters; the next migration raises that cap.
3. Release the Gateway from current `main` ([Gateway release](development-gateway-release.md)); the last pin
   (`9c0d253f`) predates #853 to #855.

## 2. Bootstrap ceilings

Apply the bootstrap root first (it is a separate Terraform root): `live_generation_model =
us.anthropic.claude-sonnet-4-6`, and the control `r1` and preparation `r1` ceilings if the live account does not
carry them. The workload boundary has 65 characters of headroom; the test floor is 50. Confirm the plan's
boundary size before the owner applies.

## 3. Resume r5 (live tailoring)

A new image with `liveGeneration.modelId` needs a new revision, as r4 did ([ADR-058](../../../docs/adr/058-edit-the-candidates-own-pdf-in-place.md)):

1. `backend/workers/ai/native-resume/configuration.r5.json` (git-ignored, copied from r4) plus
   `"liveGeneration": {"modelId": "us.anthropic.claude-sonnet-4-6"}`.
2. Publish `-ArtifactFamily NativeResume` from `main`, build the image against the published numeric owner and
   source versions, run `scripts/verify-native-resume-image.mjs`, push to `ai-job-apply/native-resume`, read back
   the digest.
3. Add `native_resume_task_releases` and `native_resume_preparation_releases` entries for r5, enable it, retire r3
   once drained (the r4 pattern). `live_generation` stays `enabled = false` until section 6.

## 4. Cover letters, first release

Order, from the module validations (*inferred*; the resume releases are the precedent):

1. **Artifacts.** From clean `main`:
   `pnpm --filter @ai-job-apply/workflows build:lambda:native-material-control-family` and
   `build:lambda:native-preparation-family`, then
   `publish-development-document-lambdas.ps1 -ArtifactFamily NativeMaterialControls` and `NativePreparation`
   (`Status`, `Publish`, `Verify`; 12 and 16 objects).
2. **Control release, flags decided as in section 0.** `native_material_control_releases.r1` with the launch,
   owner and event artifacts, plus `native_material_read_networks.cover_letter` (the dedicated task security
   group). Reuse the baseline values: zone `Z0016104CRY30UCG9QTA`, base host `materials.dev.applydash.ai`, the TLS
   secret `native-material/tls-bCk556` and its version, cluster `ai-job-apply-development`. Read the real numeric
   owner and launcher versions from `native_material_control_bindings`; "a planned version number is not
   evidence that the recipient exists".
3. **Image.** Write `backend/workers/ai/native-material/configuration.r1.json` (git-ignored; real
   `deployment.clusterArn`, predicted `taskDefinitionArn`, `ownerFunctionArn` numeric version, TLS secret and
   version, container name `native-material`, `liveGeneration.modelId`, and the API, issuer, audience, origin and
   base host copied from r4). Build:
   `docker build --platform linux/amd64 -f Dockerfile.native-material --build-arg SOURCE_SHA=<sha>
   --build-arg NATIVE_CONFIGURATION=backend/workers/ai/native-material/configuration.r1.json`. The build gate
   forbids OpenAI and requires the Bedrock client. Run `node scripts/verify-native-material-image.mjs
   --enable-local-image-tests ...`, push to `ai-job-apply/native-material` tagged with the source SHA, and read the
   digest back from ECR (there is no committed push script; the resume pushes were manual).
4. **Task and preparation releases.** `native_material_task_releases.r<N>` (the postcondition refuses a revision
   other than the expected ARN: keep launch disabled and reconcile, never retarget) and
   `native_preparation_releases.r1` with the launcher version from step 2.
5. **Activation**, one saved plan each, verifying the actual pinned versions before moving on: control
   `owner_enabled`, `control_enabled`, `recovery_enabled`; then `task_public_ip_enabled` and `route_enabled`;
   then `new_launch_enabled`. Preparation `enabled`, `launch_enabled`, `recovery_enabled`, `route_enabled`,
   `route_creation_enabled`, `intake_enabled`. Gateway `read_authorizations_enabled`, then `cover_letter_base_host`
   and `cover_letter_locations_enabled`, then `availability_enabled`, then `cover_letter_preparation_enabled`.
   Any of these requires `development_database_mode = retained` and private service endpoints.
6. **Web.** Build from `main` (it carries `bedrock-cover-letter.v1`) with `NEXT_PUBLIC_COVER_LETTER_PREPARATION_UI=enabled`
   (a build-time flag: new CLI build and deploy, see [Vercel hosting](vercel-nextjs-hosting.md)), plus
   `NEXT_PUBLIC_APPLICATIONS_UI`, `NEXT_PUBLIC_NATIVE_MATERIAL_UI`, and the server env `NATIVE_MATERIAL_BASE_HOST`.

## 5. Turn live generation on

1. Apply `live_generation` with `enabled = false` first (endpoint, burst alarm, budget; no model access).
2. Run `scripts/verify-bedrock-invocation-logging-off.ps1`; it must pass because a configured invocation log
   would keep candidate material past 30 minutes.
3. Make one synthetic, no-personal-data Converse call as the task role path's principal would, to prove the
   Anthropic form is on file.
4. Flip `enabled = true` (one role-policy edit per task role; no revision, image or release).

## 6. Evidence to collect

| Proof | How | Criterion |
|---|---|---|
| Resume tailoring is live and honest | The owner generates from their own PDF; compare with the deterministic tailor; the tailoring version in the result is `tailoring.live.v1` | D3.2-003, 006 |
| Cover letter end to end | Web app: generate, review, approve, Apply, confirmed submission in history (the extension for the live posting). With the disposable synthetic account, `start-development-native-resume-session.mjs`: `prepare`, `coverLetter`, `coverLetterStatus`, `coverLetterPreview` (shows the Bedrock model id), `coverLetterDownload` | Exit criterion 2 |
| Kill switch | Set `enabled = false`: resume falls back to `tailoring.v1`; a cover letter request shows "generation unavailable" at once (definite refusal, ADR-059 addendum 16); turn it back on | Exit criterion 4 |
| 30 minute all-copy expiry with live traffic | `start-development-native-resume-session.mjs --hold-for-expiry`, then `coverLetterExpiry` after 30 minutes (API-level: no Gateway location, native host unreachable); plus task stop receipts, no object in the document bucket, nothing in invocation logs (still off), browser copies gone at expiry; record timestamps | Exit criterion 3, D3.2-005 |
| Ashby submission | The owner picks a posting; ask before each submit; fill, attach, submit once after approval | Exit criterion 5, D3.2-007 |
| Cost | After a day: Cost Explorer service name, spend against the $20 budget, burst alarm quiet | ADR-059 decision 6 |

## 7. Shut down

Disable the cover-letter and resume intake, dispatch and routes, drain tasks, then the dormancy procedure in
[prelaunch shutdown](development-prelaunch-shutdown.md) and [database dormancy](development-database-dormancy.md):
a new final snapshot name plus a fresh `-safety` snapshot. Record the dormant inputs and the cover-letter
releases (`r1` ids, digests, versions) in the memory and delivery records so the next restore needs no release.

## Gaps to close in code

- The cover-letter commands of the session operator (`coverLetter`, status, preview, download, expiry) are built
  ([operator runbook](development-native-resume-session.md)); they have not run against a live deployment.
- No image push script for either native image.
- `development-migration-image-publication.md` and `database-migration.md` still cite 87 and 88 migrations.
