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
5. `plan-development-d2-community-recovery.ps1` produces only deterministic rollback/alarm
   prerequisites. First verify both exact receipt-bound object versions with the publication
   operator. A rollback plan then requires distinct reviewed current/previous artifact, source, and
   publication-receipt digests plus both verification switches. Its eight-step sequence requires empty queues, healthy alarms,
   pausing the exact schedule/mapping, separate checksum-reviewed rollback and restoration Terraform
   plans, immutable-alias checks, bounded probes, trigger restoration, and final zero drift. An alarm
   plan requires the exact development D2 alarm ARN, its reviewed threshold, and only the confirmed
   recipient count; the output retains a digest of the ARN rather than the ARN itself. Its five-step
   sequence requires both ALARM and OK transitions plus recipient confirmation. Both actions emit a
   stable plan SHA-256 and `mutationPerformed: false`; neither performs the exercise or grants
   approval.

   ```powershell
   .\scripts\plan-development-d2-community-recovery.ps1 `
     -Action RollbackPlan `
     -ReviewedCurrentArtifactSha256 <64-lowercase-hex> `
     -ReviewedPreviousArtifactSha256 <different-64-lowercase-hex> `
     -ReviewedCurrentSourceSha <40-lowercase-hex> `
     -ReviewedPreviousSourceSha <different-40-lowercase-hex> `
     -ReviewedCurrentReceiptSha256 <64-lowercase-hex> `
     -ReviewedPreviousReceiptSha256 <different-64-lowercase-hex> `
     -CurrentObjectVersionVerified `
     -PreviousObjectVersionVerified

   .\scripts\plan-development-d2-community-recovery.ps1 `
     -Action AlarmInjectionPlan `
     -ReviewedAlarmArn <exact-development-d2-alarm-arn> `
     -ReviewedAlarmThreshold <reviewed-number> `
     -ReviewedRecipientCount <confirmed-count>
   ```

   Actual rollback must use a checksum-reviewed Terraform plan. Alarm injection still requires both
   notification confirmations; the repository never invents either confirmation.

6. Use the dedicated D2 alarm operator to bind the actual exercise to the Terraform-owned
   `TrustSignalFailed` metric alarm and current confirmed-recipient set. `Status` is read-only and
   returns only aggregate state plus the two required digests:

   ```powershell
   node scripts/run-powershell.mjs `
     -File scripts/exercise-development-d2-alarm.ps1 `
     -Action Status
   ```

   Review the aggregate. It must report one or more confirmed recipients, zero pending recipients,
   all thirteen D2 alarms healthy, and target state `OK`. Execute only as the final alert-delivery
   gate, using the exact current digests printed by `Status`:

   ```powershell
   node scripts/run-powershell.mjs `
     -File scripts/exercise-development-d2-alarm.ps1 `
     -Action Exercise `
     -ReviewedPlanSha256 <status-plan-sha256> `
     -ReviewedRecipientSetSha256 <status-recipient-set-sha256> `
     -Execute
   ```

   The operator publishes one generated-synthetic breach and then a zero-value recovery datum; it
   does not use `set-alarm-state`, invoke a runtime, or touch queue, database, application, or
   candidate data. After directly receiving both sanitized notifications, type the exact
   confirmation requested by the operator. Retain only its final aggregate JSON. Any changed alarm,
   route, recipient set, threshold, region, plan digest, or missing recovery fails closed.

## Public policy and unauthenticated abuse boundary

This fixed development-only workload covers the anonymous signed-policy contract and the protected
contribution route's fail-closed behavior without using a token, identity, contribution payload, or
database mutation. It deliberately paces 20 policy reads below the shared one-request-per-second
public-edge ceiling, then sends a separate 20-request unauthenticated burst. Policy reads must all
return the exact bounded no-store contract; the burst may return only `401` or managed `429`.

Build the executable contract validator, resolve the exact Terraform-owned API origin in memory,
and run the explicit profile:

```powershell
pnpm --filter @ai-job-apply/api-contracts build
$apiOrigin = terraform `
  -chdir=infrastructure/terraform/environments/development output -raw gateway_url
node scripts/run-development-d2-public-boundary.mjs `
  --origin $apiOrigin `
  --confirm run-d2-development-public-boundary-v1
```

Retain only the printed aggregate. Corroborate its exact timestamps with the read-only inspector and
the already applied steady-state plan:

```powershell
.\scripts\inspect-development-workload-and-cost.ps1 `
  -Action Measure `
  -StartTime <aggregate-startedAt> `
  -EndTime <aggregate-endedAt> `
  -WorkloadProfile D2Public `
  -ExpectedAccountId <development-account-id> `
  -StateBucket <development-state-bucket> `
  -RuntimePlanPath <applied-steady-state-plan>
```

This profile proves only the public-policy and unauthenticated abuse boundary. Authenticated
contribution, idempotent replay, processing, provider verification, Trust transitions, and owner
lifecycle remain separate representative work.

All receipts stay below the ignored development `.terraform` directory. Never retain account IDs,
bucket names, tokens, raw messages, contribution data, source URLs, or provider artifacts in Git.
