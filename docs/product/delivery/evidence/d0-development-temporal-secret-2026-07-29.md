# D0 Development Temporal Runtime Secret Evidence — 2026-07-29

## Scope

This record covers the development Temporal Cloud API-key handoff into AWS Secrets Manager and a
read-only provider conformance request. It proves that the current managed secret value can
authenticate to the configured development namespace. It does not prove write permission,
workflow execution, deployed worker behavior, rotation, application deployment, or Phase 0
completion.

## Boundary and method

- Target: the dedicated AWS development account in `us-east-2`.
- AWS identity: a temporary IAM Identity Center session through the environment-specific
  administrator profile; no long-lived AWS access key was used.
- Destination: the KMS-encrypted secret
  `ai-job-apply/development/temporal-api-key`.
- The operator generated the key in Temporal Cloud and wrote it directly into AWS Secrets
  Manager. The key did not enter chat, Terraform configuration/state, repository files, command
  arguments, screenshots, or evidence.
- The [runtime-secret runbook](d0-provider-runtime-repository-cleanup-2026-08-08.md)
  requires a namespace-scoped machine identity, least namespace permission, a 90-day expiry, and
  overlap-safe rotation. Provider-side identity scope and expiry remain operator-attested until
  separately inspectable administrative evidence exists.
- The historical conformance verifier, now retired under the
  [provider/runtime cleanup](d0-provider-runtime-repository-cleanup-2026-08-08.md), retrieved the
  value only into process memory and intentionally omitted the value, AWS account ID, secret ARN,
  Temporal account suffix, endpoint, Namespace ID, and provider response payload from output.

## Results

The verifier completed successfully and reported only:

```text
AWS caller, region, and managed secret metadata passed.
Temporal Cloud authentication and namespace read conformance passed.
No secret values or environment identifiers were printed.
```

This establishes:

- the temporary AWS caller, `us-east-2`, and exact secret destination were aligned;
- exactly one secret version held the `AWSCURRENT` stage;
- the value was a non-empty plaintext API key;
- TLS authentication to the configured Temporal Cloud gRPC endpoint succeeded; and
- a one-item, read-only workflow-list request against the configured Namespace ID succeeded.

Repository formatting, lint, type checks, unit tests, and the repository skill validator passed
after the verifier and runbook were added. The verifier also failed closed before the value was
stored because the secret had no `AWSCURRENT` version.

## Limitations and next acceptance

- The read-only request cannot prove that the Temporal identity has `Write` rather than `Admin`
  permission. The controlled deployed workflow test must prove the required write capability;
  provider administrative review must confirm no broader permission remains.
- The key-expiration date and Service Account mapping are not present in repository evidence.
- Rotation has not been exercised. Before expiry, create a new key, replace `AWSCURRENT`, restart
  the worker, prove workflow completion, and only then disable/delete the old key.
- Build, test, scan, and push immutable gateway and worker images.
- Run the controlled database migration and review the exact application-enablement plan.
- Prove deployed gateway/worker health, Auth0 validation, owner isolation, persistence,
  outbox/Temporal completion, telemetry/redaction, alert delivery, rollback, and database restore.
