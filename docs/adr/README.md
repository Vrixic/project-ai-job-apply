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
- [ADR-038: One-off generated cover letters and improved resumes](038-one-off-generated-application-materials.md) (product retention direction accepted; enforcement pending D3-064)
- [ADR-035: Restricted answer values in candidate export](035-restricted-answer-values-in-candidate-export.md) (generated-synthetic engineering accepted; accountable review pending)

## Proposed delivery decisions

- [ADR-027: Profile-owned candidate rights workflows](027-profile-owned-candidate-rights-workflows.md)
- [ADR-032: Billing-owned plan limits, enforced atomically by the owning context](032-billing-owned-plan-limits-enforced-by-owning-contexts.md)
- [ADR-033: Resume deletion is a tombstone, with a separate byte purge](033-resume-deletion-is-a-tombstone-with-a-separate-byte-purge.md)
- [ADR-034: Resume byte purge runs in the candidate-rights maintenance runtime](034-resume-byte-purge-runs-in-the-candidate-rights-maintenance-runtime.md) (accepted 2026-09-21)
- [ADR-036: Structured Education and Work Experience entries](036-structured-education-and-work-experience-entries.md) (input to [D3.1-001](../product/delivery/phase-3-1-structured-profile.md); not independently accepted)

- [ADR-037: Precreated cover-letter provider slots](037-precreated-cover-letter-provider-slots.md) (proposed; conditional transport only, privacy/runtime prerequisites unfinished)

- [ADR-039: Transactional vault reference admission](039-transactional-vault-reference-admission.md) (proposed; default-off synthetic implementation)

Use `000-template.md` for future decisions.

ADRs are immutable historical records after acceptance. A new ADR supersedes an old one instead of rewriting history.

- [ADR-040: Native temporary material processes](040-native-temporary-material-processes.md) (proposed; default-off Linux process source/local evidence, transport and activation gates open)

- [ADR-041: Restricted packet values and keyed replay](041-restricted-packet-values-and-keyed-replay.md) (proposed; private source work, storage and activation gates unfinished)

- [ADR-042: Data-preserving development dormancy](042-data-preserving-development-dormancy.md) (owner-authorized prelaunch shutdown; see deployed evidence)

- [ADR-043: Protected legacy application receipts](043-protected-legacy-application-receipts.md) (proposed; local protection component, atomic transition and replay wiring pending)

- [ADR-044: Separate browser identity for native material reads](044-browser-native-material-identity.md) (owner-selected design; default-off browser implementation, live activation pending)

- [ADR-045: Manual approved application handoff](045-manual-approved-application-handoff.md) (proposed; default-off source, installed-extension and live acceptance pending)

- [ADR-046: Observed form and saved-answer selection](046-observed-form-saved-answer-selection.md) (proposed; default-off source, acceptance pending)

- [ADR-047: Withdrawn-answer application recovery](047-withdrawn-answer-application-recovery.md) (proposed; compatible release and acceptance pending)
