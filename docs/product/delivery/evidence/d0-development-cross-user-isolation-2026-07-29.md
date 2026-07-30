# D0 Development Cross-User Isolation Evidence — 2026-07-29

## Scope

This record covers one deployed negative authorization transaction in the dedicated AWS
development environment in `us-east-2`. Two distinct synthetic Auth0 accounts used the same local
server-held web boundary and the deployed regional gateway. It proves that the second account
could not read the first account's completed operation.

This evidence does not prove production approval, penetration testing, account recovery/MFA/passkey
behavior, provider/log-stream outage recovery, alert delivery, image rollback, PostgreSQL restore,
staging rehearsal, or Phase 0 completion.

## Privacy-preserving test boundary

The development-only conformance harness:

- first verifies that synthetic account A owns a deployed operation whose state is `succeeded`;
- stores the operation identifier and an HMAC identity fingerprint only inside a 15-minute,
  AES-256-GCM-encrypted, `HttpOnly`, `SameSite=Strict` cookie;
- requires a distinct issuer-and-subject identity before making the negative request;
- calls the deployed owner-scoped `GET /v1/operations/{id}` route with account B's server-held
  access token;
- passes only when the deployed API returns `404`, and treats `200` as a loud isolation failure;
- returns no token, subject, email, operation identifier, provider response, or private resource
  body to the browser; and
- clears the probe after a conclusive pass or failure.

The implementation is in the
[cross-user conformance helper](../../../../frontend/web/lib/cross-user-isolation-conformance.ts)
and its [same-origin server routes](../../../../frontend/web/app/api/auth-conformance/isolation/).
The [development runbook](../../../security/auth0-development-runbook.md) defines the operator
procedure.

## Observed transaction

The product owner:

1. completed a deployed readiness workflow as synthetic account A;
2. armed the expiring server-held probe;
3. logged out and authenticated as a distinct synthetic account B; and
4. received the sanitized result:
   `Cross-user isolation passed: this account could not read the first account's operation.`

The first UI attempt remained at `Checking…` even though AWS had already denied the request. The
cause was local conformance code awaiting cancellation of an intentionally unread response body.
The helper now discards that body without blocking, bounds the deployed request to 10 seconds, and
bounds the browser request to 15 seconds. A regression test proves the result returns even when
response-body cancellation never settles. The product owner then repeated the account-B check and
observed the pass result above.

## Sanitized AWS corroboration

A read-only aggregate inspection at `2026-07-30T01:22:17Z` covered the preceding 30 minutes and
found:

- four `GET /v1/operations/{id}` responses with HTTP `404`, including retries made while
  diagnosing the local display hang;
- the latest denied operation read at `2026-07-30T01:20:28Z`;
- zero error-level application events in the observed window;
- the gateway service `ACTIVE` at one desired, one running, and zero pending tasks; and
- the workflow worker `ACTIVE` at one desired, one running, and zero pending tasks.

Only route templates, status/count aggregates, event severity counts, timestamps, and service
counts were retained. No account identifier, issuer, subject, email, operation identifier, request
address, token, response body, ARN, or cloud-account identifier was inspected or added here.

## Repository verification

The web suite passes 22 tests, including distinct-identity enforcement, encrypted-cookie
properties, second-account `404` acceptance, cross-user `200` rejection, reflection safety, and
the non-settling-response-body regression. The web TypeScript check also passes.

This evidence advances the ownership/authorization control from local-only negative coverage to a
deployed development transaction. Accountable security/privacy approval remains a separate blocked
gate.
