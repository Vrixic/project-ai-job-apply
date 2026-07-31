# D0 Staging Authenticated Acceptance Evidence — 2026-07-30

## Scope

This record covers one controlled synthetic authenticated preference/readiness transaction and
one deployed two-account negative-authorization transaction through the isolated staging AWS and
Temporal environment in `us-east-2`.

It proves the staging gateway, PostgreSQL-backed profile store, transactional outbox, Temporal
worker, durable operation result, owner-scoped API, and privacy-safe distributed trace work
together. It does not prove independent identity-provider isolation, alert delivery,
restart/rollback, restore, workload/cost baselines, production readiness, or accountable
legal/privacy or security/privacy approval.

Under [ADR-014](../../../adr/014-shared-development-auth0-for-synthetic-staging.md), both accounts
were synthetic and staging temporarily trusted the exact development Auth0 issuer and stable API
audience. No real candidate data or live ATS interaction was permitted.

## Fail-closed launcher preflight

[PR #43](https://github.com/Vrixic/project-ai-job-apply/pull/43) merged the environment-aware
deployed-web launcher as `0ab087ec3c23c6ce8c8811359716802509def3ba`.

Before starting the local server-held BFF, the launcher:

- resolved only the encrypted staging Terraform outputs;
- confirmed the gateway ECS service was `ACTIVE` at desired `1`, running `1`, pending `0`, with a
  completed primary deployment;
- required the ignored local Auth0 issuer and audience to exactly match the live gateway task
  definition;
- required gateway live and readiness checks to return `200`; and
- required an unauthenticated protected request to return `401`.

The gateway URL remained process scoped and was neither written nor printed.

## Observed authenticated and isolation transactions

The product owner used the local server-held web boundary against the deployed staging gateway:

1. synthetic account A saved harmless preferences and completed a readiness operation;
2. the conformance harness verified account A owned that operation and that its durable state was
   `succeeded` before it allowed the probe to be armed;
3. account A logged out and a distinct synthetic account B authenticated in the same browser
   session; and
4. account B received only the sanitized result:
   `Cross-user isolation passed: this account could not read the first account's operation.`

The harness passes only when account B's bearer token receives `404` from the deployed
owner-scoped operation route. It treats `200` as an isolation failure. The encrypted, expiring
server-held probe returned no token, identity, preference, operation identifier, or private
response body to browser code or evidence.

## Sanitized deployed corroboration

A read-only 45-minute encrypted-log inspection found:

- one authenticated `PUT /v1/me/job-preferences` response with HTTP `200`;
- three owner-scoped `GET /v1/operations/{id}` responses with HTTP `200`;
- exactly one cross-user `GET /v1/operations/{id}` response with HTTP `404`;
- three owner-scoped preference reads with HTTP `404`;
- zero error-level events across 394 parsed structured events; and
- zero forbidden candidate/credential-field, email, or JWT-pattern matches.

A separate read-only ECS/IAM/X-Ray inspection found:

- both lean services stable at desired `1`, running `1`, pending `0`;
- two running, healthy, nonessential collector sidecars;
- exactly the two reviewed X-Ray write actions;
- 25 recent traces inspected in memory;
- one complete trace containing `gateway`, `outbox.dispatch`,
  `profile-readiness.mark-running`, and `profile-readiness.calculate-and-persist`; and
- zero forbidden candidate or credential field matches.

The complete trace correlates the accepted gateway write with identifier-only outbox dispatch,
the isolated staging Temporal workflow and both database-backed readiness activities. The
browser's `succeeded` state is read only after the final operation result has been durably
persisted. Read-only Temporal Cloud conformance separately reconfirmed that the staging AWS
caller, exactly one current managed-key version, namespace authentication, and namespace-read
permission remained aligned.

No account, identity, preference, operation, event, workflow, trace, task, network, database,
provider-suffix, URL, token, secret, raw log message, trace document, or response body is retained
in this evidence.

## Result and remaining acceptance

Synthetic staging authenticated workflow completion and deployed cross-user operation isolation
pass. The local client was stopped afterward without changing deployed staging services.

Remaining staging acceptance:

- confirm a human alert subscriber and prove controlled ALARM then OK delivery;
- exercise service restart and application-only rollback/reenablement;
- complete an isolated staging restore;
- record representative workload and cost-attribution baselines; and
- replace the ADR-014 exception with dedicated staging and production Auth0 tenants and replay
  the applicable matrix before launch.
