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
| `deploy-aws-platform` | AWS bootstrap, Terraform plans, Lambda durable runtime releases, managed OIDC, migrations, and restore evidence |
| `govern-delivery` | Phase task registers, evidence, blockers, start/completion records, and roadmap status |
| `frontend-awesome-design-md` | Selecting a focused local DESIGN.md reference for visual direction without copying third-party branding |
| `frontend-design` | Routing deliberate frontend design or redesign work to a bundled specialist workflow |
| `web-design-guidelines` | Reviewing UI code for current accessibility, usability, and web-interface guidance |

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

## Feature-first testing (owner decision 2026-10-21)

Feature development is the priority. Testing, acceptance and evidence work that does not protect
security or privacy is out of scope: no browser-automation passes, accessibility or load
acceptance, restore rehearsals, hosted admin acceptance, product acceptance, or per-change
evidence files. Do not add them to task registers or exit criteria.

Keep and run security work: authentication and authorization, owner isolation, restricted-answer
review, submission safety and duplicate-submission protection, deletion/export privacy
safeguards, generated-content expiry (ADR-038), dependency audit, static analysis, and the
independent pre-launch assessment (ADR-015). For ordinary feature changes, build and typecheck
the touched package and run its existing tests only when they are quick; do not write new
non-security tests unless the user asks.

Say plainly what works and what does not. Do not describe untested behavior as verified, and
label simulated responses as simulated. Record status in the phase document and tracker with one
short line per change.

## Local runtime hygiene

When a Docker-dependent step is complete and no immediately following step needs Docker, stop the
Docker Desktop engine and shut down WSL. Do not leave either runtime running unnecessarily.

## AWS shutdown before handoff (strict until product launch)

Until the owner explicitly confirms product launch, AWS services must be off whenever testing is
finished. Before ending a turn or handing work back after testing, shut down the project's AWS
test runtimes using the applicable deployment/lifecycle runbooks. This is a mandatory completion
gate, including after failed or interrupted tests; do not leave services running for convenience
or a possible future session.

Disable scheduled triggers and background work, stop or scale runtime capacity to zero, and
remove disposable billable infrastructure through the documented lifecycle where stopping does
not eliminate its ongoing charges. Account for automatic restarts; a temporary stop that later
resumes billing does not satisfy this rule. Preserve durable data, Terraform state, credentials,
and required recovery/security resources; do not use indiscriminate deletion as shutdown.

Verify the resulting AWS state and report the environment, shutdown evidence, and any retained
resources that still incur charges. Never equate an idle application with services being off or
claim zero cost without evidence. If access, authorization, or a failed shutdown prevents cleanup,
report the exact blocker and remaining billable resources as incomplete required work before
ending; do not silently waive this rule. Restart services only for the next authorized testing
session, and repeat shutdown when that session ends.
