# Delivery Tracker

Last updated: 2026-07-29
Program status: In progress
Program start: 2026-07-27
Program completion: Not completed

This is the master record for the delivery phases defined in the [product and system architecture](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md#20-delivery-roadmap). It intentionally tracks actual start and completion dates rather than predicted schedules.

## Summary

| ID | Delivery | Status | Start | Completion | Living task document |
|---|---|---|---|---|---|
| D0 | Product, data, and legal foundation | In progress | 2026-07-27 | Not completed | [Phase 0 tasks](phase-0-foundation.md) |
| D1 | Useful web product and canonical job catalog | Not started | Not started | Not completed | [Phase 1 tasks](phase-1-web-and-job-catalog.md) |
| D2 | Extension and community loop | Not started | Not started | Not completed | [Phase 2 tasks](phase-2-extension-and-community.md) |
| D3 | High-quality application preparation | Not started | Not started | Not completed | [Phase 3 tasks](phase-3-application-preparation.md) |
| D4 | Workday and remote preparation | Not started | Not started | Not completed | [Phase 4 tasks](phase-4-workday-and-remote.md) |
| D5 | Personalized outreach and application notifications | Not started | Not started | Not completed | [Phase 5 tasks](phase-5-outreach-and-notifications.md) |
| D6 | Mobile and paid launch | Not started | Not started | Not completed | [Phase 6 tasks](phase-6-mobile-and-paid.md) |
| D7 | Quality optimization, expansion, and optional employer product | Not started | Not started | Not completed | [Phase 7 tasks](phase-7-quality-and-expansion.md) |

## D0 — Product, data, and legal foundation

- Status: In progress
- Start: 2026-07-27
- Completion: Not completed
- Depends on: Approved product direction
- Task document: [Phase 0 tasks](phase-0-foundation.md)
- Exit gate: Schemas, policies, threat/data maps, engineering foundation, and an authenticated end-to-end skeleton are reviewed and evidenced.

## D1 — Useful web product and canonical job catalog

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: D0 foundation and owned schemas
- Task document: [Phase 1 tasks](phase-1-web-and-job-catalog.md)
- Exit gate: Users can reliably find, understand, save, report, and track fresh canonical jobs.

## D2 — Extension and community loop

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: D0 consent/security foundations and D1 job contribution APIs
- Task document: [Phase 2 tasks](phase-2-extension-and-community.md)
- Exit gate: Users can privately save and explicitly contribute a public job without unrelated browsing or profile data being collected.

## D3 — High-quality application preparation

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: D0 facts/contracts and D1 jobs; may use D2 active-tab extension
- Task document: [Phase 3 tasks](phase-3-application-preparation.md)
- Exit gate: Users can prepare, review by exception, approve, submit, and confirm applications on supported ATS sites with measured factuality and field accuracy.

## D4 — Workday and remote preparation

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: D3 application packets, workflows, adapter SDK, and approval invariants
- Task document: [Phase 4 tasks](phase-4-workday-and-remote.md)
- Exit gate: Supported Workday/remote variants operate safely with isolation, takeover, revalidation, confirmation, and conservative fallback.

## D5 — Personalized outreach and application notifications

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: D1 application history, D3 application truth, and D0 privacy/OAuth policies
- Task document: [Phase 5 tasks](phase-5-outreach-and-notifications.md)
- Exit gate: Relevant application notifications and truthful, user-approved outreach work without inbox/calendar access or post-submission outcome tracking.

## D6 — Mobile and paid launch

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: Stable APIs from D1–D5 and provider-neutral entitlement contracts
- Task document: [Phase 6 tasks](phase-6-mobile-and-paid.md)
- Exit gate: Web, mobile, extension, billing, support, accessibility, privacy, and evidence-based launch-capacity behavior form a reliable cross-device Free/Pro experience.

## D7 — Quality optimization, expansion, and optional employer product

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: Trustworthy preference/workflow-quality data and stable production foundations from prior deliveries
- Task document: [Phase 7 tasks](phase-7-quality-and-expansion.md)
- Exit gate: Application-quality optimization is governed; every new ATS, region, or employer capability passes its own readiness and isolation gates.

## Program work log

Append only material cross-delivery events.

| Date | Delivery | Update | Evidence |
|---|---|---|---|
| 2026-07-28 | Program | Delivery tracking system created; D0 remains in progress and D1–D7 remain not started. | This tracker and linked phase documents |
| 2026-07-28 | Program | Product scope refocused on rapid, tailored applications ending at confirmed submission. | Updated architecture, READMEs, tracker, and phase documents |
| 2026-07-28 | D0 | Repository-side foundation implemented: contracts, schemas, modular runtime, durable workflow slice, CI, Terraform, ADRs, security design, and evidence packages. D0 remains in progress behind external evidence gates. | [Phase 0 task document](phase-0-foundation.md) |
| 2026-07-28 | D0 | Local acceptance passed generated-contract stability, formatting, lint, type checks, unit/API tests, production builds, Compose validation, scope checks, and a PostgreSQL-backed profile integration. Cloud deployment and external approvals remain open. | [Phase 0 verification record](phase-0-foundation.md#work-log) |
| 2026-07-28 | D0 | Added and CI-validated seven repository-agent skills with explicit routing for onboarding, implementation, operations, deployment, architecture, contracts, and evidence-gated delivery. | [Repository skill catalog](../../../skills/README.md) |
| 2026-07-28 | D0 | Adopted ApplyDash as a provisional, configuration-driven presentation identity while preserving stable `ai-job-apply` technical identifiers; the final public-name gate remains open. | [Naming brief](../foundation/naming-brief.md), [ADR-009](../../adr/009-swappable-presentation-brand.md) |
| 2026-07-28 | D0 | Began foundational legal/privacy and security/privacy governance with review-ready briefs, a privacy impact assessment, a control-evidence matrix, accountable sign-off records, and blocking delta gates for D1–D7. External approval remains open. | [Phase 0 task document](phase-0-foundation.md), [legal/privacy brief](../foundation/foundational-legal-privacy-brief.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |
| 2026-07-28 | D0 | Recorded product direction for nationwide US/18+, provisional unformed `Vrix LLC`, restricted-answer storage with mandatory final review, non-recoverable confirmed deletion, artifact retention, and Phase 0 operational-only telemetry. The founder-dogfooding gate remains under discussion. | [Phase 0 task document](phase-0-foundation.md), [ADR-010](../../adr/010-restricted-answer-vault-and-mandatory-review.md) |
| 2026-07-28 | D0 | Resolved the founder-dogfooding decision: shared environments remain synthetic-only; founder-owned real data is isolated; any live ATS submission requires an exact-adapter legal/security/effect-safety pilot record. D0-013 is complete, but no pilot or external approval is active. | [Phase 0 task document](phase-0-foundation.md), [ADR-011](../../adr/011-staged-preproduction-data-and-founder-pilot.md) |
| 2026-07-28 | D0/D6 | Completed D0 launch-focus/provisional-positioning work and moved final public product-name/domain approval to D6-012. ApplyDash remains a swappable development identity, not an approved public origin. | [Phase 0 task document](phase-0-foundation.md), [D6 task document](phase-6-mobile-and-paid.md), [naming brief](../foundation/naming-brief.md) |
| 2026-07-28 | D0 | Selected Auth0 as the initial managed identity provider, retained provider-neutral internal identity, and defined tenant/client isolation, conformance, activation, and provider-exit controls. D0-010 is in progress; no tenant or deployed evidence exists yet. | [ADR-012](../../adr/012-auth0-initial-managed-identity.md), [Auth0 baseline](../../security/auth0-configuration-baseline.md), [Phase 0 task document](phase-0-foundation.md) |
| 2026-07-28 | D0 | Locally validated auth verifier tests, the web type check and changed-client formatting, Terraform 1.9.8 formatting, and development/staging Terraform initialization and validation. D0-010 remains in progress pending real Auth0 tenant and multi-client conformance evidence. | [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-28 | Program | Adopted `us-east-2` and a lean-until-demand runtime for every delivery: one task per service, API Gateway/Cloud Map ingress, Single-AZ PostgreSQL, optional Redis, no initial ALB/NAT, and on-demand staging. Scaling remains available through explicit inputs and requires launch, risk, recovery, or measured-demand evidence. | [ADR-013](../../adr/013-lean-until-demand-cloud-runtime.md), [architecture](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md#deployment-posture-lean-until-measured-demand), [Phase 0 task document](phase-0-foundation.md) |
| 2026-07-28 | D0 | Added an initial source-linked cost model: approximately $55–$62/month for the current lean AWS slice, $68–$75 with a web task, and $175–$200 for a small working product after Temporal credits, before material usage growth. No billing evidence exists yet. | [Operating-cost baseline](../foundation/initial-operating-cost-baseline.md), [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-28 | D0 | The full repository check and Terraform 1.9.8 formatting/init/validation pass for the lean bootstrap, development, and staging configurations. No AWS plan/apply or provider conformance is claimed. | [Phase 0 work log](phase-0-foundation.md#work-log), [Terraform workflow](../../../.github/workflows/terraform.yml) |
| 2026-07-28 | D0 | Added Auth0's server-held Next.js authorization-code session boundary, narrow token-hiding BFF routes, RS256-only gateway verification, safe local-secret setup, and conformance tests. The isolated development tenant's public discovery/JWKS checks pass; interactive login and lifecycle conformance remain open. | [Auth0 development runbook](../../security/auth0-development-runbook.md), [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-28 | D0 | Configured the development web application locally and corrected Windows startup for Node watch mode and Temporal workflow bundling. The combined web/gateway/worker runtime starts, gateway health passes, and login initiation redirects to the exact Auth0 tenant; callback completion and identity lifecycle tests remain open. | [Phase 0 work log](phase-0-foundation.md#work-log), [Auth0 development runbook](../../security/auth0-development-runbook.md) |
| 2026-07-28 | D0 | Product owner confirmed successful completion of the development Auth0 web callback. D0-010 remains in progress for authenticated API/scopes, refresh/logout/revocation, block/deletion, mobile/extension, staging, and key-rotation evidence. | [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-28 | D0 | Verified the development Auth0 web session through exact audience/scopes, internal identity mapping, owner-scoped PostgreSQL state, and Temporal completion; the authenticated vertical-slice exit criterion passes. Added locally verified Expo and MV3 public-client conformance shells plus rotation/JWKS failure tests. D0-010 remains in progress for real logout/lifecycle, device/browser, replay/revocation, and recovery/passkey/MFA evidence. | [Auth0 conformance evidence](../../security/auth0-development-conformance.md), [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-28 | D0 | Product owner confirmed web logout and exposed a returning-user gap: persisted preferences were not reloaded. Implemented authenticated owner-scoped BFF retrieval and form hydration, fixed changed-payload idempotency, and passed web/gateway plus real PostgreSQL retrieval/isolation checks. D0-010 remains in progress for visual restoration confirmation and the remaining provider/device lifecycle matrix. | [Auth0 conformance evidence](../../security/auth0-development-conformance.md), [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-28 | D0 | Product owner confirmed that saved preferences are restored after logout and reauthentication. Preference continuity now passes in the isolated development environment; the remaining Auth0 work is provider/device identity-lifecycle conformance. | [Auth0 conformance evidence](../../security/auth0-development-conformance.md), [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-29 | D0 | Added a development-only, same-origin server renewal probe with sanitized output; its tests, web type check, and production build pass, and the product owner confirmed real web renewal succeeds with rotating, expiring refresh tokens. Grant revocation and post-revocation denial remain open. | [Auth0 conformance evidence](../../security/auth0-development-conformance.md), [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-29 | D0 | Product owner revoked the synthetic user's authorized web application and confirmed forced renewal from the still-open session returned the sanitized reauthentication-required state. Web refresh and grant revocation now pass; remaining Auth0 work begins with account block/recovery. | [Auth0 conformance evidence](../../security/auth0-development-conformance.md), [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-29 | D0 | Replaced the Auth0 SDK's raw callback-error response with an allowlisted generic failure state so blocked-account and other provider errors cannot reflect descriptions into the page. Web tests (13), type checking, and production build pass; the provider block/recovery transaction remains open. | [Auth0 callback boundary](../../../frontend/web/lib/auth0.ts), [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-29 | D0 | Product owner confirmed administrator block denied the synthetic user's login, then deliberately unblocked the same user and confirmed login, owner-scoped preference restoration, and server-held renewal. Account block/recovery passes; disposable-user deletion and old-session denial are next. | [Auth0 conformance evidence](../../security/auth0-development-conformance.md), [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-29 | D0 | Product owner permanently deleted the synthetic Auth0 identity and confirmed its old application session expired and could not regain protected API access. Google SSO then provisioned a new Auth0 identity as expected; local persistence proves same-email/different-subject isolation, with visual preference isolation pending. This does not claim full platform data-erasure reconciliation. | [Auth0 conformance evidence](../../security/auth0-development-conformance.md), [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-29 | D0 | Corrected the Google SSO reprovisioning interpretation: Auth0 can recreate the user profile while the upstream Google subject remains stable, so a new profile is not proof of a new platform identity. Provider deletion/old-session denial pass; visual preference isolation and the future durable internal/provider deletion workflow remain open. | [Auth0 conformance evidence](../../security/auth0-development-conformance.md), [retention/deletion design](../../security/retention-and-deletion.md) |
| 2026-07-29 | D0 | An aggregate-only local database check confirmed the Google SSO-reprovisioned identity had no preference row and multiple distinct subjects existed for the same synthetic email; no identity values were inspected. Real-provider identity isolation passes for this run, while full platform deletion/reconciliation remains unimplemented. | [Auth0 conformance evidence](../../security/auth0-development-conformance.md), [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-29 | D0 | Reverified the Expo Auth0 public-client shell: type checking and all three configuration/privacy tests pass. Public-client setup now supports an independent mobile path; provisioning the Auth0 Native Application and completing the real Android device transaction remain open. | [Mobile shell](../../../frontend/mobile/README.md), [Auth0 development runbook](../../security/auth0-development-runbook.md), [Phase 0 work log](phase-0-foundation.md#work-log) |
| 2026-07-29 | D0, D6 | Product owner deferred real mobile Auth0 provisioning and Android/iOS device conformance from the web-focused D0 delivery to D6. The local Expo shell remains preparation; all mobile identity controls remain mandatory before mobile release. | [ADR-012 amendment](../../adr/012-auth0-initial-managed-identity.md), [Phase 0 tasks](phase-0-foundation.md), [Phase 6 tasks](phase-6-mobile-and-paid.md) |
| 2026-07-29 | D0 | Product owner formally removed D0-002 and its mandatory 20-journey participant quota. Phase 0 quality evidence now uses reproducible synthetic/deployed measurements; the consent-safe research protocol remains optional and non-blocking. | [Phase 0 tasks](phase-0-foundation.md), [optional research protocol](../foundation/research-plan.md), [quality baselines](../foundation/quality-baselines.md) |
| 2026-07-29 | D0 | Began D0-006/D0-011 deployment readiness with an exact AWS/Temporal/GitHub handoff checklist and corrected the stale ADR-007 region/certificate assumptions to the accepted `us-east-2` lean runtime. Local tooling inspection found AWS CLI and Docker available, Terraform 1.9.8 absent, and the default AWS session unsuitable because it uses a long-lived IAM user. No cloud mutation is claimed. | [Development cloud setup](../../../infrastructure/terraform/environments/development/SETUP.md), [Phase 0 tasks](phase-0-foundation.md), [ADR-007](../../adr/007-isolated-aws-environments.md) |
| 2026-07-29 | D0 | Verified the dedicated development SSO/Temporal prerequisites, deployed the reviewed 12-resource AWS state/OIDC bootstrap in `us-east-2`, migrated its state to private versioned KMS-encrypted S3, and confirmed no drift. D0-011 is now in progress; GitHub-originated OIDC, persistent platform/application, observability, rollback, and restore evidence remain open. | [Development bootstrap evidence](evidence/d0-development-bootstrap-2026-07-29.md), [Phase 0 tasks](phase-0-foundation.md), [OIDC conformance workflow](../../../.github/workflows/aws-oidc-conformance.yml) |
| 2026-07-29 | D0 | Published draft PR #1 for the Phase 0 foundation, replaced the unavailable private-repository dependency-review service with a full-lockfile audit, cleared all known dependency advisories, and corrected CI database-environment forwarding so the PostgreSQL integration genuinely runs. Local Phase 0 verification and the real integration pass; remote checks, review/merge, and GitHub OIDC conformance remain open. | [Draft PR #1](https://github.com/Vrixic/project-ai-job-apply/pull/1), [Phase 0 tasks](phase-0-foundation.md), [CI workflow](../../../.github/workflows/ci.yml) |
| 2026-07-29 | D0 | GitHub confirmed code scanning is unavailable for this private repository. Replaced the non-operational CodeQL upload with a pinned Semgrep SAST gate and corrected the threat/control records so they do not overstate GitHub security-service coverage. Remote Semgrep execution remains open. | [Static-analysis workflow](../../../.github/workflows/static-analysis.yml), [Phase 0 tasks](phase-0-foundation.md), [security approval plan](../../security/security-privacy-approval-plan.md) |
| 2026-07-29 | D0 | Draft PR #1 is cleanly mergeable at implementation commit `4a71842`, and its remote quality, dependency audit, PostgreSQL integration, container-build, pinned Semgrep, and Terraform-validation checks all pass. The PR remains draft; merge, manually dispatched AWS OIDC conformance from `main`, and deployed-environment evidence remain open. | [PR and CI evidence](evidence/d0-phase0-pr-ci-2026-07-29.md), [draft PR #1](https://github.com/Vrixic/project-ai-job-apply/pull/1), [Phase 0 tasks](phase-0-foundation.md) |
| 2026-07-29 | D0 | PR #1 merged to `main`. GitHub's immutable OIDC subject for the newly created repository required a narrowly reviewed one-resource role-trust correction; the exact plan applied with no creation or destruction and no resulting drift. GitHub-originated short-lived role assumption and encrypted bootstrap-state access now pass. | [AWS OIDC conformance evidence](evidence/d0-aws-oidc-conformance-2026-07-29.md), [successful workflow run](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30484690528), [Phase 0 tasks](phase-0-foundation.md) |
| 2026-07-29 | D0 | Deployed the 42-resource applications-disabled persistent development layer with no updates or deletions and confirmed no drift. Live checks pass for network/data isolation, bounded roles, KMS, private encrypted RDS with backups/PITR, versioned private artifacts, encrypted queues/DLQ, immutable scanning ECR, inactive ECS, managed secret destinations, encrypted logs, and baseline alarms. Application and recovery evidence remain open. | [Persistent-platform evidence](evidence/d0-development-persistent-platform-2026-07-29.md), [draft PR #9](https://github.com/Vrixic/project-ai-job-apply/pull/9), [Phase 0 tasks](phase-0-foundation.md) |

## Cross-delivery decisions and changes

| Date | Decision or change | Reason | Affected deliveries | Evidence |
|---|---|---|---|---|
| 2026-07-28 | Track actual start/completion without forecast dates. | Delivery is governed by quality gates rather than schedule predictions. | D0–D7 | Architecture delivery-roadmap principles |
| 2026-07-28 | Exclude all coaching and post-submission hiring-outcome tracking. | The product is focused on rapid, tailored, confirmed applications. | D0–D7 | Updated product architecture and phase records |
| 2026-07-28 | Approve foundational legal/privacy and security controls in D0, then require capability-specific delta approval in the delivery that implements the behavior. | Review must begin during design but remain tied to concrete data flows, providers, permissions, and deployed evidence. | D0–D7 | [Legal review register](../foundation/legal-review-register.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |
| 2026-07-28 | Persist only candidate-supplied restricted answers and always include them in the final application review and immutable packet approval. | Reduce repeated entry without silently deciding or inferring sensitive facts. | D0, D3, D4 | [ADR-010](../../adr/010-restricted-answer-vault-and-mandatory-review.md) |
| 2026-07-28 | Allow isolated founder-only real-data dogfooding before entity formation; allow live founder ATS submissions only through exact-adapter, expiring pilot approval. | Obtain realistic evidence without exposing invited users or generalizing one approval to other variants. | D0, D3, D4 | [ADR-011](../../adr/011-staged-preproduction-data-and-founder-pilot.md) |
| 2026-07-28 | Move final public product-name/domain approval from D0 to D6 while retaining configuration-driven ApplyDash branding for development. | Naming is not a foundation dependency; public origins, OAuth branding, email, stores, billing, and launch still require an owned and approved identity. | D0, D6 | [Naming brief](../foundation/naming-brief.md), [D6 task](phase-6-mobile-and-paid.md) |
| 2026-07-28 | Use Auth0 as the initial managed OIDC provider while preserving `issuer + subject` identity mapping and a controlled dual-provider migration path. | Auth0 is the strongest direct fit for the accepted multi-client OIDC/PKCE contract; provider selection must not become product-data lock-in. | D0 onward | [ADR-012](../../adr/012-auth0-initial-managed-identity.md), [Auth0 baseline](../../security/auth0-configuration-baseline.md) |
| 2026-07-28 | Use `us-east-2` and keep all phases lean until launch review, security/recovery requirements, or measured production demand justifies scaling. | Preserve quality and the architectural scale path while avoiding idle replicas, ALB, Redis, Multi-AZ data, NAT, and continuously provisioned staging. | D0–D7 | [ADR-013](../../adr/013-lean-until-demand-cloud-runtime.md), [delivery rules](README.md#tracking-rules) |
| 2026-07-29 | Defer real mobile OIDC application/device conformance to D6; it no longer blocks D0. | Current implementation is web-focused, and mobile release must be tested against the actual D6 client rather than only its foundation shell. | D0, D6 | [ADR-012 amendment](../../adr/012-auth0-initial-managed-identity.md), [Auth0 conformance matrix](../../security/auth0-development-conformance.md) |
| 2026-07-29 | Remove mandatory representative-user research and the fixed 20-journey quota from D0. | Pre-product participant recruitment is not needed to prove the foundation; synthetic/deployed quality evidence remains mandatory and optional later research retains consent safeguards. | D0 | [Phase 0 tasks](phase-0-foundation.md), [optional research protocol](../foundation/research-plan.md) |

## Program blockers and risks

| ID | State | Risk or blocker | Affected deliveries | Owner | Mitigation or next action |
|---|---|---|---|---|---|
| PR-001 | Open | ApplyDash is the provisional development identity; final public name/domain remain a D6 release blocker. | D6 public release | Product owner | Complete D6-012 before production OAuth/email/store/public identity activation. |
| PR-002 | Blocked | Accountable legal/privacy counsel and accountable security/privacy approvers are unavailable. Participant research is no longer a D0 requirement. | D0 onward | Product owner | Assign counsel and security/privacy reviewers, then complete the prepared evidence workflows. |
| PR-003 | Blocked | The isolated Auth0 web lifecycle, authenticated durable slice, GitHub-originated AWS OIDC conformance, and lean persistent development platform pass. Web recovery/MFA/passkey, deployed provider/log-stream, application enablement, alert delivery, rollback, restore, and E2E evidence remain incomplete. Mobile device conformance is a D6 release gate, not a D0 blocker. | D0 onward | Product owner; platform engineering | Finish remaining web/provider checks, supply managed secrets, deploy the application slice, and run observability/rollback/restore/E2E acceptance; execute mobile conformance in D6. |
