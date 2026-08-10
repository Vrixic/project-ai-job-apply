# D0 Staging Temporal Runtime Secret Evidence — 2026-07-30

## Scope

This record covers the isolated staging Temporal Cloud namespace/API-key handoff into AWS Secrets
Manager and a secret-safe read-only provider conformance request. It proves that the managed
staging secret can authenticate to the configured staging namespace. It does not prove workflow
write permission, deployed worker behavior, rotation, application deployment, or Phase 0
completion.

## Boundary and method

- Target: the dedicated AWS staging account in `us-east-2`.
- AWS identity: a temporary IAM Identity Center session through the environment-specific
  administrator profile; no long-lived AWS access key was used.
- Destination: the KMS-encrypted secret `ai-job-apply/staging/temporal-api-key`.
- The staging namespace is distinct from development. The operator created a namespace-scoped
  service account with account-level read access, namespace-level write access, and a 90-day key,
  then wrote the key directly into AWS Secrets Manager.
- The key did not enter chat, Terraform configuration/state, repository files, command arguments,
  screenshots, or evidence.
- The [runtime-secret runbook](d0-provider-runtime-repository-cleanup-2026-08-08.md)
  requires least privilege, expiration, and overlap-safe rotation. Provider-side role assignment
  and expiry remain operator-attested until separately inspectable administrative evidence exists.
- The historical conformance verifier, now retired under the
  [provider/runtime cleanup](d0-provider-runtime-repository-cleanup-2026-08-08.md), retrieved the
  value only into process memory and omitted the value, AWS account ID, secret ARN, Temporal
  account suffix, endpoint, Namespace ID, and provider response payload from output.

## Results

The verifier completed successfully and reported only:

```text
AWS caller, region, and managed secret metadata passed.
Temporal Cloud authentication and namespace read conformance passed.
No secret values or environment identifiers were printed.
```

This establishes:

- the temporary staging AWS caller, `us-east-2`, and exact secret destination were aligned;
- exactly one secret version held the `AWSCURRENT` stage;
- the value was a non-empty plaintext API key;
- TLS authentication to the configured staging Temporal Cloud gRPC endpoint succeeded; and
- a one-item, read-only workflow-list request against the configured staging Namespace ID
  succeeded.

No secret or environment identifier is retained in this evidence.

## Limitations and next acceptance

- The request proves namespace read access, not the operator-attested write scope. The controlled
  deployed workflow must prove the required write capability.
- Provider administrative review must confirm the service account has no broader permission and
  record the key-expiration/rotation owner without retaining the key.
- The staging application remains disabled. Review and apply its exact enablement plan before
  exercising the worker.
- Prove deployed gateway/worker health, Auth0 validation under the temporary synthetic-only
  [ADR-014](../../../adr/014-shared-development-auth0-for-synthetic-staging.md) exception, owner
  isolation, persistence, outbox/Temporal completion, telemetry/redaction, alert delivery,
  rollback, restore, workload, and cost attribution.
