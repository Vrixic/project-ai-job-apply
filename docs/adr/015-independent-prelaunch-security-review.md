# ADR-015: Independent Pre-Launch Security Review

Status: Accepted
Date: 2026-07-31

## Context

Phase 0 defines and seeks accountable approval for foundational security and privacy controls, but
it cannot assess web, API, extension, mobile, billing, automation, provider, and production-cloud
behavior that does not yet exist. Automated CI scanning and repository-authored tests also cannot
provide independent assurance that the final deployed attack surface rejects unauthorized use.

Some platform routes are intentionally public, while candidate, service, administrative,
webhook, and artifact operations have different trust boundaries. A blanket goal that outsiders
cannot reach any API would be inaccurate and would not prove object, function, property, role, or
business-flow authorization.

## Decision

Public launch is blocked on an independent, open-book security assessment and penetration test of
the exact launch candidate in D6. The assessment follows the
[API security and final-review baseline](../security/api-security-and-final-review.md) and covers
the complete external surface, web/API authorization, cross-user and cross-role isolation,
identity/session lifecycle, mobile and extension clients, application-agent business logic,
cloud/IAM/configuration, supply chain, data handling, abuse/resource controls, recovery, and
incident readiness.

Every endpoint must have an owned exposure class. Anonymous access is allowed only for an
explicitly public capability with minimal data and bounded resource use. Candidate APIs require
valid environment-specific identity plus server-side object, function, and property
authorization. Service and administrative APIs require separate non-public and least-privilege
boundaries; webhooks require authenticated replay-safe handling.

Launch acceptance requires no unresolved Critical or High finding, explicit expiring treatment
for every unresolved Medium finding, tracked lower findings, independent retest of material fixes,
and signed dispositions from the independent reviewer and product owner. The review is repeated
after material trust-boundary changes or serious control failure and at least annually while the
product is public.

## Consequences

Phase 0 security/privacy approval remains a foundation-design gate and does not become a false
production certification. Capability-specific reviews remain in their owning deliveries. D6 now
owns the integrated final assessment after the actual launch candidate, dedicated identity
environments, and production-equivalent staging exist.

The assessor requires scoped access to architecture, source, test accounts/roles, deployed
evidence, and a safe rules-of-engagement environment. Findings can delay launch and must remain
traceable through remediation, retest, risk acceptance, and expiry. Automated scanners support
the assessment but cannot replace manual authorization and business-logic testing.

## Alternatives

- Treat Phase 0 approval as final product approval. Rejected because most public attack surface
  and irreversible product behavior is not implemented in Phase 0.
- Rely only on CI scanners and internal tests. Rejected because they do not independently test
  deployed configuration, chained attacks, authorization, or product-specific abuse paths.
- Make every API private. Rejected because intentional public product surfaces still require
  explicit exposure, minimal data, and abuse controls, while clients need supported public entry
  points.
