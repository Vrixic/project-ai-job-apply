# Repository Agent Instructions

## Product boundary

Build a candidate-first platform for rapidly preparing and submitting truthful, tailored job
applications. The product ends at confirmed submission. Do not add coaching, interview
preparation, inbox/calendar reading, or collection of interviews, offers, rejections, recruiter
responses, or other post-submission outcomes.

Prefer quality, simplicity, robustness, scalability, and long-term maintainability over forecast
cost or delivery speed. Never invent candidate facts, silently answer sensitive questions,
circumvent CAPTCHA/MFA, or commit production PII, credentials, tokens, or raw user artifacts.

## Repository skills

Repository-specific skills live in `skills/`. Before acting, select the smallest applicable set
and read each selected `SKILL.md` completely.

| Skill | Use for |
|---|---|
| `repo-onboarding` | Repository orientation, ownership, current capabilities, and where to begin |
| `operate-local-platform` | Installation, local services, migrations, verification, and debugging |
| `guard-product-architecture` | Product scope, service boundaries, security, privacy, data, AI, ATS, and cross-cutting design |
| `evolve-platform-contracts` | OpenAPI, events, domain schemas, field ontology, generated types, and SQL migrations |
| `build-vertical-slice` | Implementing a capability through client, gateway, persistence, outbox, workflow, and tests |
| `deploy-aws-platform` | AWS bootstrap, Terraform plans, images, managed OIDC/Temporal configuration, rollout, and restore evidence |
| `govern-delivery` | Phase task registers, evidence, blockers, start/completion records, and roadmap status |

Use multiple skills only when the request crosses their responsibilities. For example, a deployed
API change normally uses `evolve-platform-contracts`, `build-vertical-slice`, and
`deploy-aws-platform`; a deployment status question normally uses only `deploy-aws-platform`.

## Sources of truth

- Product and system intent: `docs/PRODUCT_AND_SYSTEM_ARCHITECTURE.md`
- Accepted decisions: `docs/adr/`
- Security and privacy: `docs/security/`
- Delivery state: `docs/product/delivery/DELIVERY_TRACKER.md` and the linked phase document
- Executable API source: `packages/api-contracts/openapi/`
- Domain/event schema sources: `packages/domain/schemas/` and `packages/event-contracts/schemas/`
- Cloud composition: `infrastructure/terraform/`

Read the relevant source before answering repository-specific questions. Clearly distinguish
implemented, locally verified, deployed, planned, and externally blocked behavior.
