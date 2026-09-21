# Architecture Decision Records

Records important technical decisions, their context, alternatives, consequences, and status so future maintainers understand why the system took a particular shape.

## Accepted foundation decisions

- [ADR-001: Monorepo and module boundaries](001-monorepo-and-module-boundaries.md)
- [ADR-002: Provider-neutral OIDC authentication](002-provider-neutral-oidc.md)
- [ADR-003: PostgreSQL ownership and PII](003-postgresql-ownership-and-pii.md)
- [ADR-004: Temporal, outbox, and idempotency](004-temporal-outbox-and-idempotency.md)
- [ADR-005: UGC lifecycle](005-ugc-lifecycle.md)
- [ADR-006: Contract-first compatibility](006-contract-first-compatibility.md)
- [ADR-007: Isolated AWS environments](007-isolated-aws-environments.md)
- [ADR-008: Observability and redaction](008-observability-and-redaction.md)
- [ADR-009: Swappable presentation brand](009-swappable-presentation-brand.md)
- [ADR-010: Restricted answer vault and mandatory review](010-restricted-answer-vault-and-mandatory-review.md)
- [ADR-011: Staged preproduction data and founder pilot](011-staged-preproduction-data-and-founder-pilot.md)
- [ADR-012: Auth0 as the initial managed identity provider](012-auth0-initial-managed-identity.md)
- [ADR-013: Lean-until-demand cloud runtime](013-lean-until-demand-cloud-runtime.md)
- [ADR-014: Temporary shared development Auth0 for synthetic staging](014-shared-development-auth0-for-synthetic-staging.md)
- [ADR-015: Independent pre-launch security review](015-independent-prelaunch-security-review.md)
- [ADR-016: Scale-to-zero application runtime](016-scale-to-zero-application-runtime.md)
- [ADR-017: Zero-traffic pre-cutover ECS idle posture](017-zero-traffic-precutover-ecs-idle-posture.md)
- [ADR-018: Disposable prelaunch staging data plane](018-disposable-prelaunch-staging-data-plane.md)
- [ADR-019: Defer foundational counsel review to public launch](019-defer-foundational-counsel-review-to-public-launch.md)
- [ADR-020: Defer accountable foundation security/privacy review to launch](020-defer-accountable-foundation-security-review-to-launch.md)
- [ADR-021: Own provider fixtures with adapter deliveries](021-own-provider-fixtures-with-adapter-deliveries.md)
- [ADR-022: Quarantine and scan candidate document uploads](022-quarantine-and-scan-candidate-document-uploads.md)
- [ADR-023: Isolate untrusted document parsing from candidate data](023-isolate-untrusted-document-parsing.md)
- [ADR-024: Application history and inbox phase ownership](024-application-history-and-inbox-phase-ownership.md)
- [ADR-025: Govern public ATS feed activation without a separate counsel gate](025-public-ats-feed-activation-governance.md)
- [ADR-026: Host Next.js presentation boundaries on Vercel](026-vercel-nextjs-presentation-hosting.md)
- [ADR-028: Separate private saves, public contributions, Jobs truth, and UGC trust](028-extension-ugc-ownership-and-processing.md)
- [ADR-029: Use one explicit public-job addition command in the extension](029-one-step-public-job-addition.md)
- [ADR-030: AI gateway and grounded generation](030-ai-gateway-and-grounded-generation.md)
- [ADR-031: Deterministic resume tailoring in the Documents runtime](031-deterministic-resume-tailoring-in-documents-runtime.md)

## Proposed delivery decisions

- [ADR-027: Profile-owned candidate rights workflows](027-profile-owned-candidate-rights-workflows.md)
- [ADR-032: Billing-owned plan limits, enforced atomically by the owning context](032-billing-owned-plan-limits-enforced-by-owning-contexts.md)
- [ADR-033: Resume deletion is a tombstone, with a separate byte purge](033-resume-deletion-is-a-tombstone-with-a-separate-byte-purge.md)
- [ADR-034: Resume byte purge runs in the candidate-rights maintenance runtime](034-resume-byte-purge-runs-in-the-candidate-rights-maintenance-runtime.md)

Use `000-template.md` for future decisions.

ADRs are immutable historical records after acceptance. A new ADR supersedes an old one instead of rewriting history.
