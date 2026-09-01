# Repository Skills

These repository-local skills give coding agents focused operating knowledge without duplicating
the full architecture in every prompt.

| Skill | Primary questions and work |
|---|---|
| [`repo-onboarding`](repo-onboarding/SKILL.md) | “How does this repo work?”, “Where should this code go?”, contributor onboarding |
| [`operate-local-platform`](operate-local-platform/SKILL.md) | Local setup, services, migrations, tests, builds, and troubleshooting |
| [`guard-product-architecture`](guard-product-architecture/SKILL.md) | Architecture reviews, product boundaries, privacy, security, ATS/AI/UGC design |
| [`evolve-platform-contracts`](evolve-platform-contracts/SKILL.md) | API, event, schema, taxonomy, generated type, and database contract changes |
| [`build-vertical-slice`](build-vertical-slice/SKILL.md) | Contract-first implementation spanning platform layers |
| [`deploy-aws-platform`](deploy-aws-platform/SKILL.md) | AWS/Terraform bootstrap, planning, deployment, verification, rollback, and restore |
| [`govern-delivery`](govern-delivery/SKILL.md) | Evidence-gated phase and master-tracker maintenance |
| [`frontend-awesome-design-md`](frontend-awesome-design-md/SKILL.md) | Focused local DESIGN.md references for visual direction |
| [`frontend-design`](frontend-design/SKILL.md) | Router for bundled frontend design and redesign workflows |
| [`web-design-guidelines`](web-design-guidelines/SKILL.md) | UI accessibility, usability, and interface-guideline reviews |

Every skill has UI metadata in `agents/openai.yaml`. `AGENTS.md` provides the routing catalog used
by repository-aware agents. Skill folders intentionally contain no duplicate README or copied
architecture; their instructions route agents to current source files.
