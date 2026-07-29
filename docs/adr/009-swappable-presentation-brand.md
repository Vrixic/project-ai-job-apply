# ADR-009: Swappable presentation brand

Status: Accepted
Date: 2026-07-28

## Context

The product needs a coherent working identity before its final public name is known. Binding a
provisional brand to package scopes, databases, event identities, authentication audiences, cloud
resources, or source paths would turn a later naming decision into a risky infrastructure
migration. A candidate domain must also never be treated as an owned network origin before
registration and approval.

## Decision

Use **ApplyDash** and `applydash.ai` as the provisional presentation identity. Keep
`ai-job-apply` as the stable internal technical identifier.

Resolve presentation names through `@ai-job-apply/config/brand` with client-appropriate
environment overrides. Keep routable origins, email domains, legal entity names, package scopes,
database names, event sources, OIDC audiences, Compose projects, and cloud resource identifiers
separate from presentation branding.

The candidate domain is descriptive metadata only until ownership and public-brand approval are
recorded. The public-name delivery gate remains open.

## Consequences

- A future brand change updates the shared default, environment values, and presentation content
  without renaming stable infrastructure.
- Technical logs and resource names may continue to use `ai-job-apply`; they are not public-brand
  claims.
- Every new client must consume the shared brand contract instead of hard-coding a product name.
- Domain ownership, trademark, store, handle, linguistic, and counsel screening remain required.

## Alternatives

- Rename all technical identifiers now: rejected because the brand is provisional and such
  coupling creates unnecessary future migrations.
- Keep showing `AI Job Apply`: rejected because it no longer provides the chosen working identity.
- Delay all branding: rejected because development and review surfaces need a consistent label.
