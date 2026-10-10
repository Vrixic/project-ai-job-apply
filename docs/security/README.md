# Security and Privacy Documentation

Contains the security architecture and evidence required to protect candidate identity, career history, connected accounts, and application actions.

## Foundation documents

- [Threat model](threat-model.md)
- [Privacy impact assessment](privacy-impact-assessment.md)
- [Data flow and classification](data-flow-and-classification.md)
- [Consent model](consent-model.md)
- [Retention and deletion](retention-and-deletion.md)
- [Subprocessor register](subprocessors.md)
- [Auth0 configuration and migration baseline](auth0-configuration-baseline.md)
- [Auth0 development tenant runbook](auth0-development-runbook.md)
- [Auth0 development conformance evidence](auth0-development-conformance.md)
- [Security and privacy approval plan](security-privacy-approval-plan.md)
- [Phase 0 accountable review record](phase-0-accountable-review-record.md)
- [API security and independent final review](api-security-and-final-review.md)
- [Phase 2 extension and UGC security/privacy delta](d2-extension-ugc-security-privacy.md)
- [Dependency vulnerability exceptions](dependency-vulnerability-exceptions.md)
- [Phase 0 incident-response runbook](../../infrastructure/runbooks/incidents/phase-0-incident-response.md)
- [Vulnerability-management runbook](../../infrastructure/runbooks/security/vulnerability-management.md)

This directory contains policy and sanitized evidence, never live secrets, tokens, or raw user data.

Development recovery preservation source is tracked in [ADR-048](../adr/048-privacy-reconciled-development-recovery.md)
and the [replay runbook](../../infrastructure/runbooks/restore/candidate-deletion-recovery-replay.md).
Aggregate whole-row proof does not establish managed recovery or accountable privacy acceptance.
