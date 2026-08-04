# Development Serverless Workflow Dark Conformance

Use the shared [serverless workflow dark-conformance runbook](serverless-workflow-dark-conformance.md)
with the compatibility wrapper below. The wrapper fixes the environment to `development` and uses
the development IAM Identity Center profile by default.

```powershell
.\scripts\operate-development-serverless-workflow-dark-conformance.ps1 -Action Plan
```

Execution and cleanup retain the shared runbook's separate exact-checksum and explicit `-Execute`
gates. This wrapper does not authorize staging, cutover, or retirement.
