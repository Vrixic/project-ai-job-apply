# D2 community default-dark operations

These source operators do not authorize activation. Keep contribution routes, the scheduled rule,
and the Trust signal event-source mapping disabled until every Phase 2 accountable gate passes.
The independently gated anonymous policy endpoint may be enabled with a current signed all-disabled
envelope. It communicates the fail-closed state to installed clients and does not authorize intake.

Before a future activation, create the offline development signing key and a short-lived signed
policy below the ignored operator directory. The default `Sign` action enables no capability:

```powershell
pnpm --filter @ai-job-apply/jobs-service build
node scripts/operate-development-d2-contribution-policy.mjs `
  --action GenerateKey `
  --key-id d2-development-20260903-v1

node scripts/operate-development-d2-contribution-policy.mjs `
  --action Sign `
  --key-directory infrastructure/terraform/environments/development/.terraform/development-d2-contribution-policy/d2-development-20260903-v1 `
  --key-id d2-development-20260903-v1 `
  --revision d2-development-dark-20260903-v1 `
  --client-version 0.2.0 `
  --lifetime-minutes 60
```

Never copy the private key into Terraform, an extension environment file, source, evidence, logs,
or chat. Terraform receives only the signed envelope and PEM public-key map; the extension embeds
only the base64url DER SPKI public-key map. A future enabled signing run requires the exact
activation-authority token printed by `--action Help` plus independently reviewed dimensions.

1. Run `operate-development-d2-community-artifact.ps1 -Action Status` with the exact development
   account, versioned encrypted state bucket, and the separate versioned encrypted artifact bucket.
2. From clean reviewed `main`, publish the deterministic artifact with `-Action Publish -SourceSha`.
3. Independently hash and review the private receipt, then use `-Action Verify` to read the exact S3
   object version back. Publication never updates Lambda or a trigger.
4. Use `verify-development-d2-community-dark.ps1` for read-only checks that all D2 routes, schedule
   targets, and queue mappings remain dark. After intentionally deploying only the anonymous,
   all-disabled policy endpoint, add `-AllowPolicyEndpoint`; this permits exactly that one GET route
   while continuing to reject every contribution, private-read, and Trust route.
5. `plan-development-d2-community-recovery.ps1` produces only rollback/alarm prerequisites. Actual
   rollback must use a checksum-reviewed Terraform plan. Alarm injection requires accountable metric
   thresholds, alarm ARN, SNS recipients, and both ALARM and OK delivery confirmation; none are
   invented by the repository.

All receipts stay below the ignored development `.terraform` directory. Never retain account IDs,
bucket names, tokens, raw messages, contribution data, source URLs, or provider artifacts in Git.
