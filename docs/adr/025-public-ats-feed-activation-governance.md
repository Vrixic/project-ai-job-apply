# ADR-025: Govern Public ATS Feed Activation Without a Separate Counsel Gate

Status: Accepted
Date: 2026-08-23
Supersedes: The LR-D1-01 through LR-D1-03 release consequences introduced by
[ADR-019](019-defer-foundational-counsel-review-to-public-launch.md)

## Context

Phase 1 uses only the provider-published unauthenticated job-posting GET surfaces for Greenhouse,
Lever, and Ashby. It does not use application-submission endpoints, employer credentials,
candidate records, private ATS data, broad crawling, or arbitrary URLs. The repository owner has
directed that a separate legal/counsel approval is not required to implement or activate these
three bounded public-read adapters.

Removing that approval dependency does not establish a legal conclusion or make a public endpoint
an unlimited-use grant. The exact employer board/site still determines data quality, attribution,
freshness, removal, and operational behavior, and an incorrect configuration could mix company
identity or retain misleading jobs.

## Decision

- Mark LR-D1-01, LR-D1-02, and LR-D1-03 `Removed` as counsel-owned Phase 1 release gates. Preserve
  their review material as non-authoritative risk documentation; no legal approval is claimed.
- Permit implementation and bounded activation of only the existing fixed-host, public GET
  Greenhouse Job Board, Lever Postings, and Ashby Job Board adapters.
- Require an exact product/source-engineering activation record for every company configuration:
  provider, company name, verified company domain, board token/site/job-board name, Lever region
  where applicable, source ID, adapter version, configuration SHA-256, artifact/version, environment,
  cadence, and accountable operator.
- Keep each source default-off and independently disableable. Activation requires the global
  runtime gate, explicit provider authority, private NAT egress, immutable artifacts, aggregate-only
  telemetry, exact provenance, and the Jobs-owned immutable pause tuple. A pause has no resume;
  reactivation requires a new activation record.
- Keep application POST endpoints, credentials, arbitrary crawling, representative response
  capture, public UGC, candidate data, compensation, and unlisted/private jobs outside this decision.
- Retain employer/provider correction and takedown handling, positive revalidation, bounded
  acquisition, redirect refusal, and incomplete-poll safety as engineering/product acceptance
  conditions. Absence or a failed poll never proves withdrawal.
- LR-D1-04 and every real-candidate privacy, security, rights, identity, deletion/export, and
  document-parser gate remain unchanged.

## Consequences

- Counsel availability no longer blocks D1-003 engineering or a reviewed public-feed activation.
- Activation still cannot proceed with invented or inferred company identifiers. The operator must
  provide the exact companies/boards to ingest and accept their source configuration.
- Provider and public-page quality must be demonstrated with bounded live evidence before D1-003
  or crawlability can be completed.
- Any authenticated/private provider surface, application action, new provider, broad crawler, or
  materially expanded field/data use requires a new decision and its own review.

## Alternatives

- **Keep separate counsel approval for all three feeds.** Rejected by the repository owner for
  Phase 1's bounded public GET integrations.
- **Treat public documentation as unrestricted authority.** Rejected because it would discard
  source-specific quality, attribution, rate, revalidation, and takedown controls.
- **Enable generic arbitrary-URL ingestion.** Rejected because it would expand SSRF, provenance,
  permission, and content-quality risk beyond the three reviewed fixed-host adapters.
