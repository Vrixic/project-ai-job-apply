# D1 Managed Identity and Gateway Authorization Acceptance — 2026-08-13

- Task: D1-001
- Result: Complete for the web-focused, synthetic-development boundary
- Reviewed application revision: `47d7802c2896f0c2db8ee843aa4d75c2c5a322b3`
- Environments represented by inherited evidence: local web client and deployed AWS development
  API; synthetic identities only

## Outcome

D1-001 reuses the managed identity, server-held web session, authenticator/recovery, and gateway
authorization boundary completed by D0-010. The D1 profile and catalog slices have exercised that
boundary without introducing a browser token store, provider identifier in product contracts, test
authentication bypass, or alternate authorization path. No additional identity implementation or
cloud/provider mutation is required for this bounded task.

This acceptance closes the authentication portion of the D1 exit criterion. Resume
import/confirmation and complete onboarding remain D1-002 work, so the combined exit criterion and
the D1 delivery remain open.

## Acceptance map

| Boundary | Disposition | Evidence |
|---|---|---|
| Managed web authentication | Passed | Auth0 Universal Login, exact authorization-code callback, sanitized callback failure, logout, exact issuer/audience discovery, RS256 validation, and provider recovery passed under [D0-010](../phase-0-foundation.md#task-register) and the [Auth0 conformance matrix](../../../security/auth0-development-conformance.md). [ADR-012](../../../adr/012-auth0-initial-managed-identity.md) preserves a provider-neutral contract. |
| Server-held sessions | Passed | The [web Auth0 boundary](../../../../frontend/web/lib/auth0.ts) keeps access and refresh material out of browser code and disables a browser access-token endpoint. Forced renewal, rotating/expiring refresh behavior, logout, grant revocation, account block/recovery, provider deletion, and old-session denial are recorded in the [Auth0 conformance matrix](../../../security/auth0-development-conformance.md). |
| Web authenticator and recovery controls | Passed for the D1 web scope | Passkey enrollment and fresh sign-in, TOTP reauthentication, recovery-code use, administrator-assisted lost-factor reset/re-enrollment, and passkey survival passed with a disposable synthetic user. See [web passkey/MFA/recovery evidence](d0-auth0-web-passkey-mfa-recovery-2026-07-30.md). |
| Provider-neutral identity ownership | Passed | The [Profile identity mapping](../../../../backend/services/profile/src/index.ts) resolves exact `issuer + subject` to an internal UUID rather than using email or a provider identifier as product identity. Same-email/different-subject isolation and deployed two-account denial are recorded in the [Auth0 conformance matrix](../../../security/auth0-development-conformance.md) and [cross-user isolation evidence](d0-development-cross-user-isolation-2026-07-29.md). |
| Gateway authentication and scopes | Passed | API Gateway uses an exact issuer/audience JWT authorizer; the Lambda adapter accepts only validated API Gateway identity context and exact routes; the application layer independently requires the route scope. Missing/invalid tokens fail with sanitized `401`, missing scopes with `403`, and cross-user resources with indistinguishable `404`. See the [Terraform boundary](../../../../infrastructure/terraform/modules/platform/main.tf), [Lambda adapter](../../../../backend/gateway/src/lambda.ts), and [gateway authorization boundary](../../../../backend/gateway/src/app.module.ts). |
| D1 adoption | Passed for implemented route families | The deployed profile-fact slice proves authenticated owner-scoped create/read/correct/reject behavior and two-account isolation; the deployed job-read slice proves fresh `jobs:read` authorization and stable anonymous denial. Dedicated document scopes and route denial are covered by the current gateway/web tests while D1-002 continues the document-processing rollout. See [profile-fact acceptance](d1-profile-fact-foundation-2026-08-12.md) and [job-read acceptance](d1-development-job-read-api-release-2026-08-11.md). |

## Fresh repository verification

The following focused checks passed on 2026-08-13 without changing application, AWS, or Auth0
state:

- `pnpm --filter @ai-job-apply/auth test` — 7/7 tests passed;
- `pnpm --filter @ai-job-apply/gateway test` — 46/46 tests passed; and
- `pnpm --filter @ai-job-apply/web test` — 45/45 tests passed.

The suites cover exact issuer/audience/algorithm/signature/expiry handling, JWKS rotation and
failure behavior, validated API Gateway principal bridging, exact route and scope enforcement,
owner isolation, sanitized failures, server-held token forwarding, and authenticated web session
behavior. These focused results supplement rather than replace the deployed D0 and D1 evidence
linked above.

## Preserved later gates and non-claims

This acceptance does not claim production readiness, public web hosting, real-user approval,
independent security approval, or isolated staging/production identity. It does not implement a
platform-owned session/device database or an Auth0 Management API runtime client.

- D2 owns extension PKCE, refresh/replay, logout, cancellation, browser failure, and
  current-device/all-device revocation evidence.
- D6 owns mobile secure storage and device conformance, cross-device session behavior,
  dedicated staging and production Auth0 tenants, launch-candidate conformance replay, the final
  custom domain and passkey re-enrollment, sensitive-action step-up policy, account-deletion
  lifecycle, and independent exact-candidate assessment.
- Any future web self-service session/device inventory or revoke-all control must be recorded
  explicitly with the cross-device/account-security delivery rather than inferred from D1-001.

See the [D2 task register](../phase-2-extension-and-community.md),
[D6 task register](../phase-6-mobile-and-paid.md), and
[Auth0 configuration baseline](../../../security/auth0-configuration-baseline.md) for those gates.
