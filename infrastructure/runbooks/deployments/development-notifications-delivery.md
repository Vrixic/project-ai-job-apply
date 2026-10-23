# Development notification delivery (email and push)

[ADR-056](../../../docs/adr/056-notification-email-and-push-delivery.md). Delivery is dark until every
step below is done. Nothing here changes an inbox item; the inbox is always the fallback.

## What Terraform creates

With `notifications_enabled = true` (Gateway routes) and `notifications_delivery_enabled = true`:

- an EventBridge rule `rate(1 minute)` targeting the profile readiness activity alias (enabled only
  while `serverless_runtime_enabled`), with the shared dead-letter queue;
- `ses:SendEmail` for the activity role, scoped to the identity and configuration set and bound to the
  exact From address;
- the SES identity and a TLS-required configuration set (when `notifications_email_identity` is set);
- an empty Secrets Manager container for the VAPID identity (when
  `notifications_vapid_secret_provisioned` is true) with read access for the activity role only.

It requires an active candidate-rights policy whose owner inventory lists `notifications`
(`d4-development-synthetic-v1`), so account deletion and export already cover this data.

## Owner steps (cannot be done by Terraform)

1. **Pick the sender.** A domain identity (`example.com`) is best. Terraform outputs
   `notifications_ses_dkim_tokens`; add the three CNAME records
   `<token>._domainkey.<domain>` pointing to `<token>.dkim.amazonses.com` in the DNS zone. An address
   identity (`name@example.com`) is the quick test path: SES emails a confirmation link to it.
2. **Sandbox.** New SES accounts can only send to verified addresses. For development, verify the
   test recipient addresses in SES. To email real candidates, request production access in the AWS
   console (SES, Account dashboard, Request production access).
3. **VAPID key.** Generate it and store it in memory only (the private key is never written to a
   file; it is briefly a process argument on the operator machine):

   ```powershell
   $keys = node scripts/generate-notifications-vapid-keys.mjs --subject mailto:ops@example.com | ConvertFrom-Json
   aws secretsmanager put-secret-value --secret-id <notifications_vapid secret ARN> `
     --secret-string ($keys.secret | ConvertTo-Json -Compress)
   $keys.publicKey   # set notifications_push_public_key to this
   Remove-Variable keys
   ```

   Rotate by writing a new secret version and changing `notifications_push_public_key`; browsers
   re-subscribe the next time the candidate opens Settings.

## Deploy order

1. Publish the migration image and run the migrations (adds the `notifications` schema).
2. Release the Gateway and activity Lambdas with the candidate-rights policy
   `d4-development-synthetic-v1` and `notifications_enabled`.
3. Add the SES identity, secret container and (after the owner steps) `notifications_delivery_enabled`.
4. Verify: confirm an address in Settings and receive the code within about a minute; turn on browser
   notifications and receive a push for a new inbox item.

## Operating notes

- The dispatcher result is counts only (codes sent, sent, skipped, failed, retried, deferred).
  Failures that end in `failed` leave the inbox item untouched.
- A permanent SES rejection suppresses that address for the candidate; a different address can be
  confirmed. Bounce and complaint feeds are not wired yet.
- Delivery is at least once; after a crash a duplicate message is possible.
