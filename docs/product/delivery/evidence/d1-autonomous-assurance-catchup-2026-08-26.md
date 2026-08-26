# D1 autonomous assurance catch-up — 2026-08-26

## Scope and outcome

Exact revision `eacdc8adbd42561712914c76ed63ebe42726ed01` closes three source-level
Phase 1 assurance gaps without using a provider, candidate data, Docker, WSL, Vercel, MFA, or an
external approval:

- the ingestion runner now passes a validated immutable attempt (`1` through `5`) to every adapter;
  the fixed, unschedulable `synthetic-d1-provider-fault-v1` adapter returns exactly one
  `source_unavailable` retry at attempt 1 and an empty success from attempt 2 onward;
- the alert operator has opt-in strict aggregate JSON for representative status and delivery
  exercise evidence, binds the exact confirmed-recipient-set digest before mutation, and records
  delivery only after an operator explicitly confirms both sanitized notifications; and
- a versioned, generated-only PDF/DOCX adversarial corpus exercises 43 envelope/package cases and
  additional mocked post-parse PDF controls without committing binary or third-party documents.

The same revision synchronizes stale API/security/evaluation/ingestion/architecture documentation
with the currently deployed and default-dark Phase 1 boundaries. It does not claim the provider
failure profile is deployable yet: the synthetic adapter intentionally is not registered in the
normal scheduled-source list. An IAM-only, untriggered durable fixture handler and guarded operator
remain the next autonomous engineering slice.

## Verification

- Ingestion worker unit tests: `96/96` across 10 files.
- Ingestion worker typecheck and build: pass.
- Documents unit tests: `87/87` across 8 files.
- Documents typecheck: pass.
- Alert aggregate operator tests: pass in PowerShell 7 and Windows PowerShell 5.1.
- Scoped Biome checks and `git diff --check`: pass.
- Docker Desktop and WSL were not started.

Repository-wide formatting/lint were also inspected. They remain red only on pre-existing files
outside this change: the already committed candidate-rights policy JSON formatting and
`skills/frontend-design` scripts/assets. Those unrelated files were not rewritten or presented as
evidence for this packet.

## Safety and non-claims

- No provider URL, ATS adapter, public route, scheduler, queue mapping, candidate identity, resume,
  database, Terraform state, or AWS resource was contacted or mutated.
- A handled synthetic retry is not an alert-delivery confirmation. The separate canary still
  requires the reviewed recipient digest and attributable human receipt confirmation.
- Fixed workloads and local tests are not capacity, production SLO, RTO/RPO, accessibility,
  security/privacy, source-quality, or product acceptance.
- Phase 1 remains in progress.
