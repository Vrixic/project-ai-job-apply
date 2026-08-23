# D1 Development Entitlement Direct Acceptance

Date: 2026-08-23  
Environment: synthetic development  
Runtime source: `eac06e17393a311ed7ac251a415601cb7eb7b4ee`

## Outcome

The deployed provider-neutral entitlement read passed through immutable, unweighted development
gateway alias version `28`. A generated-synthetic validated-authorizer context with `profile:read`
invoked the exact `GET /v1/entitlements` Lambda route and received HTTP `200`, `Cache-Control:
no-store`, canonical Free/version-zero state, and the exact four current core grants.

The route accepts no owner identifier and Billing receives only the Profile-owned internal UUID.
The absent-account implementation is read-only and has no public Billing mutation route. This
invocation may refresh the established generated-synthetic Profile identity's `last_seen_at`; it is
not evidence of a Billing account mutation or real billing data.

This accepts the direct deployed Lambda read only. It does not prove API Gateway JWT/JWKS handling,
managed OIDC, the hosted web BFF/UI, a real identity, payment behavior, or Phase 1 completion.

## Evidence

- Acceptance receipt SHA-256:
  `3827350f5b95f90abde949aa52ad75d4775f3607d5cb01ab2acfe5132d932e15`.
- The response contained only `accessState`, `evaluatedAt`, `grants`, `plan`, and `version`.
- `plan=free`, `accessState=active`, and `version=0`.
- Grants were exactly `profile.manage`, `jobs.search`, `jobs.save`, and
  `applications.history`, in the contracted order.
- The evaluation timestamp was exact canonical UTC milliseconds.
- Gateway alias version `28` remained unchanged, no gateway alarm was in `ALARM`, and Terraform
  state remained serial `145`.

## Remaining D1-008 gates

- Managed-OIDC and real API Gateway/JWT/JWKS acceptance.
- Hosted server-session BFF/UI browser acceptance.
- Human security/privacy/product acceptance remains part of the Phase 1 exit matrix.
- Payment providers, pricing, checkout, webhooks, paid-only capabilities, and real billing data
  remain intentionally outside this Phase 1 skeleton.
