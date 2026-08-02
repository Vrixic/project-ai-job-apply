# D0-016 Gateway Lambda Boundary Hardening — 2026-08-02

- Scope: repository implementation, immutable release, exact development apply, and deployed
  no-write boundary conformance
- Target environment: development dark Lambda
- Public runtime: unchanged ECS gateway
- Deployment result: applied to the dark Lambda alias; no public route change

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

The exact merged `main` commit was published by
[workflow run 30735796145](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30735796145).
Gateway build/tests, the High-severity dependency audit, two-build reproducibility, CycloneDX SBOM,
private/versioned/customer-managed-KMS bucket checks, and immutable artifact write all passed.

A checksum-matched refresh-backed plan contained zero creates, exactly two updates, zero deletes,
and zero replacements. The only updates were the Lambda function artifact/version and the
environment alias. The exact plan applied as reviewed while reserved concurrency remained `2`,
the reviewed extension layer remained pinned, both ECS services stayed stable, and API Gateway
continued routing public traffic to ECS.

The first deployed matrix run correctly reached the scope-denial response but exposed a verifier
assumption: Fastify adds the valid `charset=utf-8` parameter to `application/problem+json`. The
operator now compares the media type independently of optional parameters and reports the exact
failed contract field; status, problem code, trace identifier, and `no-store` checks remain strict.
PowerShell syntax parsing passed after this correction.

The complete deployed matrix then passed all 15 cases with the expected status sequence: one
`200`, four `401`, one `403`, three `404`, four `400`, one `415`, and one `413`. Both preflights
passed, the alias executed one immutable version, no persistent application write occurred, and
public traffic did not change. A final refresh-backed completed-dark check accounted for all 11
reviewed resources with zero creates, updates, deletes, replacements, or drift.

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

This record now proves the immutable development apply and the deployed no-write boundary matrix.
It does not yet claim the authenticated browser owner-isolation replay for this exact version or
alias rollback readiness; both remain required before the version is accepted as the second
rollback endpoint.
