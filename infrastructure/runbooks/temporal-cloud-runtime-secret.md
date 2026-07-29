# Temporal Cloud Runtime Secret

Use this runbook to create, store, verify, and later rotate the development worker's Temporal
Cloud API key. The key must never enter chat, a repository file, Terraform, a command-line
argument, an issue, a screenshot, or delivery evidence.

The development destination is the KMS-encrypted AWS Secrets Manager secret
`ai-job-apply/development/temporal-api-key` in `us-east-2`. Terraform owns the secret container;
the operator owns its value and Temporal lifecycle.

## Preconditions

- The dedicated development AWS SSO session works through profile
  `ai-job-apply-development-admin`.
- The applications-disabled persistent Terraform layer has been applied without drift.
- Temporal namespace API-key authentication is enabled.
- A namespace-scoped Service Account exists for the development worker.
- That Service Account has the fixed `Read` account role and only `Write` permission for the
  development namespace. It must not have `Admin` namespace permission.

Do not use the Namespace page's shortcut **Generate API Key** button. Temporal currently makes
that shortcut key namespace `Admin` and gives it the maximum two-year expiration, which exceeds
this worker's required permission and rotation window. See Temporal's current
[Service Account](https://docs.temporal.io/cloud/manage-access/service-accounts) and
[API-key](https://docs.temporal.io/cloud/api-keys) documentation for the provider behavior behind
this restriction.

## Create the key in Temporal Cloud

1. Sign in to the Temporal Cloud UI as an Account Owner, Global Administrator, or the Namespace
   Admin allowed to manage the namespace-scoped Service Account.
2. Recheck the Service Account before generating a credential:
   - identity type: namespace-scoped Service Account;
   - account role: `Read`;
   - namespace: the full development Namespace ID;
   - namespace permission: `Write`.
3. Open **Settings → API Keys**. A Namespace Admin may instead use
   **Profile → API Keys**.
4. Select **Create API Key**.
5. For **Create an API key for**, select **Service Account**, then map it to the verified
   development worker Service Account.
6. Use:
   - name: `ai-job-apply-development-worker`;
   - description: `Development ECS Temporal worker runtime`;
   - expiration: 90 days from creation.
7. Select **Generate API Key**. Temporal shows the key only once.

Do not close the one-time value until the AWS secret has been saved.

## Store the key directly in AWS

1. In a separate browser tab, sign in to the dedicated AWS development account.
2. Select region **US East (Ohio) / `us-east-2`**.
3. Open **Secrets Manager** and select
   `ai-job-apply/development/temporal-api-key`.
4. Choose **Retrieve secret value**, then **Set secret value** or **Edit**.
5. Select **Plaintext**, replace the entire value with the one-time Temporal API key, and save it.
   Do not wrap it in JSON or add quotes, spaces, or a newline.
6. Close the Temporal one-time-value dialog and clear the clipboard.
7. Record only the Temporal key ID, Service Account ID, owner, creation date, and expiration in
   the private operations register. Do not record the key value.

## Verify without exposing the key

Use the full namespace and gRPC endpoint shown in the Temporal Namespace **Connect** box. Neither
argument is a secret, but delivery evidence should still omit the Temporal account suffix.

```powershell
aws sso login --profile ai-job-apply-development-admin

pnpm --filter @ai-job-apply/workflows cloud:verify -- `
  --address "<namespace>.<account>.tmprl.cloud:7233" `
  --namespace "<namespace>.<account>"
```

The verifier:

- confirms the SSO caller, region, and exact secret destination align;
- requires exactly one `AWSCURRENT` value version;
- retrieves the value only into process memory;
- authenticates to Temporal Cloud and performs a read-only one-item workflow-list request; and
- prints no key, account ID, ARN, Namespace ID, endpoint, or response payload.

Success ends with:

```text
AWS caller, region, and managed secret metadata passed.
Temporal Cloud authentication and namespace read conformance passed.
No secret values or environment identifiers were printed.
```

Do not mark the runtime secret ready from AWS metadata alone. Both AWS and Temporal lines must
pass.

## Rotate

1. Create a new 90-day Service Account API key without disabling the current key.
2. Replace the AWS secret's plaintext value with the new key.
3. Run the verifier and require both conformance lines.
4. When the application is deployed, force a new worker deployment so the task loads
   `AWSCURRENT`, then prove worker connectivity and workflow completion.
5. Disable the prior key, monitor the worker, and delete the prior key only after the new task is
   healthy.
6. Record key IDs, dates, and evidence links without values.

Temporal sends expiry notices before expiration, but the operations owner remains responsible for
rotation. If verification fails or unexpected use is observed, disable the affected key, restore a
known-good version only when it remains valid, and keep application enablement blocked.
