# D0-016 Gateway Lambda Boundary Hardening — 2026-08-02

- Scope: repository implementation and local verification
- Target environment: development dark Lambda
- Public runtime: unchanged ECS gateway
- Deployment result: not yet deployed

## Outcome

The versioned Lambda gateway now owns an explicit transport boundary before Nest/Fastify dispatch.
It allows only the Phase 0 method/path inventory, rejects unsupported query strings and request
bodies, requires JSON for the preference command, strictly decodes API Gateway base64 bodies, and
enforces a 64 KiB decoded-body ceiling. Missing or malformed trusted authorizer claims continue to
fail closed before application dispatch.

Authorization scopes now come only from API Gateway's validated `authorizer.jwt.scopes` array.
The claims map cannot manufacture a permission, and the guarded bridge/verifier emits the same AWS
event shape used at cutover.

Every boundary failure returns the version-one `ProblemDetails` shape with a correlation ID and
`cache-control: no-store`. Application-produced authentication, scope, validation, ownership, and
idempotency errors are also explicitly non-cacheable.

## Compatibility

The version-one OpenAPI contract receives additive error-response declarations:

- `400` for unsupported transport input on candidate routes;
- `403` for an authenticated caller without the required scope;
- `413` for a decoded preference body above 64 KiB; and
- `415` for a preference body that is not JSON.

No success shape, path, method, persisted entity, event, migration, or client request changes. The
generated TypeScript contract was regenerated from the OpenAPI source rather than edited by hand.

## Automated matrix

The gateway suite now covers:

- exact anonymous health access;
- missing, wrong-issuer, wrong-audience, and missing-subject authorizer denial;
- invocation-local identity isolation and capability cleanup;
- unknown route, unknown method, and malformed operation-ID denial;
- unexpected query strings and GET bodies;
- missing PUT body, non-JSON media, malformed base64, and oversized decoded bodies;
- read/write scope denial;
- idempotent replay, changed-payload conflict, missing idempotency metadata, strict schema
  rejection, preference persistence, and owned operation retrieval.

The focused gateway run passed 33 tests. The repository-wide quality, lint, typecheck, and test
pipeline also passed after the implementation.

## Deployed verifier

`scripts/verify-development-gateway-lambda-boundary.ps1` prepares a 15-case, no-write acceptance
matrix for the immutable development alias. It runs the existing AWS/Terraform/Auth0/ECS/API
preflight before and after direct alias invocations, requires one immutable executed version,
checks exact stable status/code/problem headers, and uses only cases that cannot create or mutate a
candidate, preference, operation, outbox, or workflow record.

The operator has passed PowerShell syntax parsing but has not been run against the currently
deployed older artifact. Running it before the hardened artifact is merged, published, and applied
would produce an expected failure and is not deployment evidence.

## Release and rollback order

1. Merge the reviewed source and contract change.
2. Build, scan, and publish the deterministic Lambda artifact from that exact merged commit.
3. Review and apply only the function-artifact/version and alias update; public API traffic must
   remain on ECS.
4. Run the 15-case deployed boundary matrix and the authenticated owner-isolation conformance.
5. Exercise alias rollback from the new accepted version to the current accepted identity-safe
   version, rerun safe health/access/owner-isolation checks, and restore the new version in
   `finally`.
6. Finish with the alias on the new accepted version, all alarms healthy, Terraform at zero drift,
   and the public ECS integration unchanged.

Until those deployed steps pass, this record proves repository implementation only and does not
claim a second accepted Lambda release or rollback readiness.
