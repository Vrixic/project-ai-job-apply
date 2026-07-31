# ADR-014: Temporary Shared Development Auth0 for Synthetic Staging

Status: Accepted
Date: 2026-07-30

## Context

[ADR-012](012-auth0-initial-managed-identity.md) requires independent development, staging, and
production Auth0 tenants. The current Auth0 Free subscription provides one tenant, and the
development tenant has already passed the web-focused Phase 0 conformance matrix. AWS accounts,
state, data, keys, logs, queues, images, and Temporal namespaces are independently provisioned for
development and staging.

The immediate choice is to leave staging applications disabled until another Auth0 tenant is
available or to accept a narrowly bounded identity-provider exception for synthetic pre-launch
staging. This exception must not be mistaken for environment isolation or launch readiness.

## Decision

Until launch preparation, synthetic-only staging may trust the exact development Auth0 issuer and
the stable `ai-job-apply-api` audience.

- Reuse is limited to controlled engineering acceptance with synthetic identities and synthetic
  product data.
- Staging must not process real candidate data, host invited testers, make live ATS submissions,
  become public, or be represented as a release candidate while this exception is active.
- The staging gateway receives only the public issuer and audience configuration needed for token
  verification. Development Auth0 client secrets, Management API credentials, and session secrets
  must not be copied into staging AWS.
- AWS accounts, Terraform state, PostgreSQL, KMS keys, Secrets Manager containers, queues, logs,
  images, and the Temporal namespace and API key remain environment isolated.
- Staging identity isolation is explicitly not proved: Auth0 users, signing keys, authentication
  logs, administrative controls, provider availability, and provider failure modes are shared
  with development.
- Before staging processes a real user or becomes a launch candidate, provision independent
  staging and production Auth0 tenants, applications, APIs, credentials, and approved domains.
  Replay the applicable identity, client, lifecycle, outage, owner-isolation, and recovery
  conformance in each owning environment before activation.
- Production must never trust or share the development Auth0 tenant.
- If the current subscription still prevents tenant isolation at the D6 launch gate, upgrade the
  Auth0 arrangement or migrate to an approved provider. The isolation gate cannot be waived.

This ADR temporarily supersedes only ADR-012's requirement for a separate Auth0 tenant in
synthetic pre-launch staging. All other ADR-012 controls remain accepted.

## Consequences

Phase 0 staging acceptance can exercise the deployed AWS and Temporal path without paying for a
second Auth0 tenant before it carries real users. A development identity-provider outage,
configuration change, key rotation, user action, or administrator error can also affect staging,
so staging cannot currently prove provider fault isolation.

Delivery and security records must label evidence collected under this arrangement as
synthetic-only and must not claim independently isolated staging identity. D6 owns the mandatory
cutover and repeated conformance before launch.

## Exit criteria

The exception ends only when:

1. dedicated staging and production Auth0 tenants exist;
2. environment-specific web, mobile, extension, API, and administrative clients are created only
   where their owning delivery requires them;
3. secrets, callbacks, origins, domains, signing keys, users, logs, and administrators are
   isolated;
4. staging is cut over from the development issuer and its applicable conformance matrix passes;
5. production conformance and accountable security/privacy approval pass before public use; and
6. the development issuer is absent from production trust configuration.

## Alternatives

- Leave staging applications disabled until another tenant is available. Rejected for synthetic
  Phase 0 acceptance because exact issuer validation can safely exercise the isolated AWS and
  Temporal path within the controls above.
- Treat one Auth0 tenant as fully isolated staging. Rejected because shared users, keys, logs,
  administration, and provider failure modes do not provide identity isolation.
- Create a test-token bypass. Rejected because it would not test the accepted OIDC boundary and
  would weaken fail-closed behavior.
