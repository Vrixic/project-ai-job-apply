# ADR-011: Staged Preproduction Data and Founder Pilot

- Status: Accepted as product direction; legal/privacy and security conditions still apply
- Date: 2026-07-28

## Context

Synthetic data is required for repeatable development and safe shared environments, but it cannot
prove every personalization, rendering, authentication, or external ATS behavior. The legal entity
will not be formed until most of the product works. Processing invited users' data or broadly
enabling irreversible external actions before foundational controls would create unnecessary risk.

## Decision

Use three progressively stronger boundaries:

1. Shared development, CI, staging, demos, and regression tests use synthetic candidate data and
   sanitized/synthetic ATS fixtures only.
2. The founder may dogfood personalization using only the founder's own data in a local or dedicated
   isolated environment with encryption, redacted telemetry, explicit cleanup, and no public or
   invited-user access.
3. A founder-only live submission may be enabled for one exact ATS/variant only after a written
   pilot release record proves its legal/terms disposition, isolation, strong authentication,
   restricted-answer review, immutable packet approval, revalidation, idempotency, duplicate and
   ambiguous-response safety, confirmation evidence, auditability, manual fallback, and kill
   switch.

Each live pilot approval is narrow, versioned, expiring, and independently revocable. CAPTCHA, MFA,
signatures, attestations, ambiguity, and changed questions always require direct founder action.
The pilot does not authorize another user, ATS/variant, public UGC, outreach, production ingestion,
bulk application behavior, or public launch.

Closed alpha requires entity formation, foundational legal/privacy and security approval, managed
identity, deployed access controls, deletion/export tests, incident ownership, and approved
providers. Public production additionally requires every delivery-specific release gate.

## Consequences

The product can be tested realistically before entity formation without weakening shared
environment hygiene or treating founder consent as consent for anyone else. Live adapter testing
will occur later than synthetic adapter development because every external effect needs scoped
evidence and accountable approval. No live pilot is currently authorized merely by accepting this
ADR.
