# Staging Serverless Workflow Dark Conformance

Use the shared [serverless workflow dark-conformance runbook](serverless-workflow-dark-conformance.md)
with the wrapper below. The wrapper fixes the environment to `staging` and uses the isolated
staging IAM Identity Center profile by default.

```powershell
.\scripts\operate-staging-serverless-workflow-dark-conformance.ps1 -Action Plan
```

Before planning, regenerate the completed-dark zero-change plan from the same clean merged commit.
Execution is a bounded AWS mutation: three synchronous invalid-input probes, one exact-version
asynchronous durable failure, one exact synthetic DLQ deletion, and four alarm transitions. It
requires separate authorization of the generated context checksum. The mapping and schedules stay
disabled, the reconciler is never invoked, product data is not written, and public routing remains
unchanged.

Execution and cleanup retain the shared runbook's separate exact-checksum and explicit `-Execute`
gates. This wrapper does not authorize cutover, Temporal retirement, or obsolete-resource removal.
