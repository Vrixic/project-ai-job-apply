# Development notification delivery (email)

[ADR-056](../../../docs/adr/056-notification-email-and-push-delivery.md). Delivery is dark until every
step below is done. Nothing here changes an inbox item; the inbox is always the fallback.

## What Terraform creates

With `notifications_enabled = true` (Gateway routes) and `notifications_delivery_enabled = true`:

- an EventBridge rule `rate(1 minute)` targeting the profile readiness activity alias (enabled only
  while `serverless_runtime_enabled`), with the shared dead-letter queue;
- `ses:SendEmail` for the activity role, scoped to the identity and configuration set and bound to the
  exact From address;
- the SES identity and a TLS-required configuration set (when `notifications_email_identity` is set);
- a legacy empty Secrets Manager container for a VAPID identity (browser push was removed on
  2026-10-24, so nothing reads it; the Terraform for it is removed in a follow-up change).

It requires an active candidate-rights policy whose owner inventory lists `notifications`
(`d4-development-synthetic-v1`), so account deletion and export already cover this data.

## Owner steps (cannot be done by Terraform)

1. **Pick the sender.** A domain identity (`example.com`) is best. Read the tokens with
   `aws sesv2 get-email-identity --email-identity <domain> --query DkimAttributes.Tokens` and add the three CNAME records
   `<token>._domainkey.<domain>` pointing to `<token>.dkim.amazonses.com` in the DNS zone. An address
   identity (`name@example.com`) is the quick test path: SES emails a confirmation link to it.
2. **Sandbox.** New SES accounts can only send to verified addresses. For development, verify the
   test recipient addresses in SES. To email real candidates, request production access in the AWS
   console (SES, Account dashboard, Request production access).
## Deploy order

1. Publish the migration image and run the migrations (adds the `notifications` schema).
2. Release the Gateway and activity Lambdas with the candidate-rights policy
   `d4-development-synthetic-v1` and `notifications_enabled`.
3. Enable `notifications_enabled`, then `notifications_delivery_enabled`. The SES identity and configuration set are created with delivery, so the DKIM tokens exist only after that step.
4. Verify: open Settings (the account email is recorded when the page loads and must be verified at
   the identity provider), tick the email box, save, send a test notification and receive the email within
   about a minute. In the SES sandbox the
   account address must also be a verified SES identity.

## Operating notes

- The dispatcher result is counts only (sent, skipped, failed, retried, deferred).
  Failures that end in `failed` leave the inbox item untouched.
- Diagnose delivery in the application log group: `notifications_dispatched` (counts, only when a run did
  something) and `notification_delivery_error` (an error class or provider code such as
  `ses_AccessDeniedException`, never an address). A retry with no such line predates this logging.
- A permanent SES rejection suppresses that address for the candidate; a different address can be
  confirmed. Bounce and complaint feeds are not wired yet.
- The dispatcher role can only send when the shared workload permissions boundary also allows
  `ses:SendEmail` (bootstrap `SendEmail` statement). Without it SES is never called and every attempt
  ends as a `transient_error` retry with no log line. Apply bootstrap before relying on delivery.
- Delivery is at least once; after a crash a duplicate message is possible.
