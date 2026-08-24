# D1 Development Provider-Capable Ingestion Dark Release

Date: 2026-08-23  
Environment: development  
Deployed application source: `7eb4fe33ba8cfe16eb49ee283fa8f12cba60a655`

## Outcome

The bounded Greenhouse, Lever, and Ashby ingestion successor is published, migrated, and
dark-deployed in development. The release preserves separate immutable configuration digests,
coordinator identities, and persisted pause identities per configured source while keeping every
provider and every ingestion trigger disabled.

The deployment contains no company configuration. Provider activation authority is false, the
configured provider-source count is zero, the runtime and generated-synthetic source gates are
false, both EventBridge rules and the SQS event-source mapping are disabled, and both queues are
empty. No provider credential, network request, provider job data, or real candidate data was used.

This supersedes the synthetic-only runtime recorded in
[the earlier dark-release evidence](d1-development-ingestion-dark-release-2026-08-23.md). It closes
the provider-capable publication, Jobs `0009` migration, and dark-deployment gaps. D1-003 remains
in progress pending exact company inputs, an explicit activation record, bounded live-provider
acceptance, live persisted source-pause acceptance, and final human acceptance.

## Source verification and immutable artifacts

- The exact source passed all 32 repository check tasks, all 19 build tasks, and the centralized
  dependency audit. The audit retained only the two already governed mobile exceptions.
- The Linux/AMD64 migration image passed two deterministic builds, runtime verification,
  immutable manifest readback, and a complete scan with zero Critical and zero High findings.
- Migration platform digest:
  `sha256:a81dd98e4a09b3bf949161b549874e83e8c5149276f0f642b3dbbf0ef265fcd9`.
- Migration index digest:
  `sha256:f14821ecc14174156667a7b98d823a9e2ab4bf7832e31ba58913152c1013564a`.
- Migration publication receipt SHA-256:
  `413296b0c518c2ecf1af328106c7246dc6e74b8bddbbf570555917a11a509c42`.
- Two independent ingestion builds produced identical archives. Durable archive SHA-256:
  `97125ae927fe6bb33276f715eb5eb9dc1c89d1851e70ebb579bac80159f6a00e`;
  runtime archive SHA-256:
  `4090819790ed810ea27fbe71b23db7c6b3f09dce339de835b585094b05a877b5`.
- The eight ZIP, SBOM, manifest, and checksum objects were published under deterministic,
  source-bound keys in the private versioned artifact bucket with customer-managed KMS
  encryption. Every exact object version passed checksum, metadata, and content readback.

No account identifier, bucket name, database endpoint, secret identifier, or raw operator artifact
is retained in this evidence.

## Terraform plan and apply

- Saved apply-plan SHA-256:
  `f9a43c2a79b6ba47fa001a198e794eaa0627cec30c29baf4ba1e04e432d845d3`.
- Automated field review accepted 14 bounded changes: two create-before-destroy replacements,
  eleven updates, and one computed data read. The plan contained no public-route, gateway, or NAT
  change and kept provider activation authority false, provider-source count zero, runtime enable
  false, and generated-synthetic enable false.
- Applying that exact saved plan added two resources, changed ten, and destroyed two superseded
  resources. State lineage was unchanged and development advanced to serial `149`.
- All five ingestion aliases point to exact unweighted numeric version `2`.
- The idle migration task definition advanced to revision `38` and remained digest-pinned.

## Database migration evidence

One exact no-override Fargate migration task ran on the otherwise idle migration cluster. It stopped
because its essential container exited successfully with code `0`. The six aggregate log markers
verified:

1. Profile migrations through `0005_resume_fact_proposals`.
2. Jobs migrations through `0009_provider_ingestion_sources`.
3. Documents migrations through `0002_resume_processing`.
4. Matching migrations through `0001_saved_jobs`.
5. Billing migrations through `0001_entitlement_projection`.
6. All service-owned migrations applied and verified.

The current recovery composition therefore contains 18 migrations across the five contributors,
eight declared schemas, and 42 non-system relations. The ECS migration cluster returned to zero
services and zero tasks.

## Dark-runtime readback and zero drift

- Deployed provider activation authority is false and configured provider-source count is zero.
- Runtime enable and generated-synthetic source enable are both false.
- Both EventBridge rules and the single SQS event-source mapping are disabled.
- The two encrypted 4-day/14-day queues are empty.
- All fourteen ingestion alarms are healthy.
- The deployed durable and runtime code hashes match the exact published artifacts.
- ECS has zero services and zero active tasks.
- Refresh-backed zero-drift plan SHA-256:
  `c00033da3fe2c310e74205b4be67b59923185217cd94750830baeecb6009709b`,
  with zero resource changes and zero output changes at state serial `149`.

Docker Desktop and WSL were stopped after artifact publication because no immediately following
step required them.

## Remaining D1-003 gates

- Supply and review at least one exact company source: provider, company name, verified company
  domain, stable source identifier, and provider-specific public board identifier.
- Record explicit source-engineering activation authority before enabling any provider, runtime,
  schedule, or mapping.
- Run bounded live-provider acceptance and prove provenance, canonicalization, expiry, queue/alarm
  behavior, and exact cleanup without exposing provider or candidate data in evidence.
- Prove that a live persisted source pause prevents new work during an enabled run.
- Complete final accountable human acceptance at the end of Phase 1.

Greenhouse, Lever, and Ashby do not require a separate Phase 1 counsel approval under ADR-025.
That repository governance decision is not a general legal conclusion and does not itself activate
any source.
