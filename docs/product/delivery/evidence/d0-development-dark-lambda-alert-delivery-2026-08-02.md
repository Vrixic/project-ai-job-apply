# D0-016 Development Dark Lambda Alert Delivery — 2026-08-02

- Environment: development
- Region: `us-east-2`
- Runtime under observation: unrouted gateway Lambda alias
- Public runtime during drill: existing ECS gateway
- Result: passed

## Outcome

The three development gateway Lambda alarms are healthy and route ALARM and OK actions through the
already accepted encrypted operational-notification path. A dedicated synthetic canary traversed
that same topic and delivered both transitions to the confirmed operator subscription. The product
owner confirmed receipt of one ALARM notification and one OK recovery notification.

The exercise changed only the dedicated synthetic canary metric. It did not generate a Lambda
error or throttle, modify an application/database/queue record, move API traffic, or alter the
Lambda alias.

## Read-only wiring proof

The preflight found:

| Check | Result |
|---|---:|
| Gateway Lambda metric alarms | 3 |
| Alarms in `OK` | 3 |
| Actions enabled | Yes |
| Exact Lambda function dimension | Yes |
| One ALARM action per alarm | Yes |
| One OK action per alarm | Yes |
| Shared reviewed action destination | Yes |
| Confirmed subscriptions | 1 |
| Pending subscriptions | 0 |

The alarms cover aggregate Lambda errors, throttles at the database-protecting concurrency ceiling,
and p95 duration. Their action destination matches the canary's reviewed destination; no endpoint,
subscription identifier, topic identifier, account identifier, or raw notification is retained.

## Delivery exercise

The existing guarded operator:

1. required the confirmed subscription and both notification actions;
2. established the healthy canary state;
3. emitted one synthetic failure datapoint and observed `ALARM`;
4. emitted the recovery datapoint and observed `OK`; and
5. emitted a final healthy datapoint in `finally`.

After the product owner confirmed both emails, a read-only post-check found the canary back in
`OK`, one confirmed and zero pending subscriptions, and both actions still present. Development
AWS/Terraform/Auth0 alignment, the dark alias, JWT authorizer, stable ECS rollback service,
unchanged public integration, and health prerequisites also passed afterward.

## Rollback safety disposition

Alias rollback was deliberately not exercised. The only older published Lambda version predates
the accepted identity-propagation correction and is known to reject valid authenticated requests.
Using it would demonstrate only mechanical alias movement, not a truthful functional rollback.

The next meaningful accepted gateway release must retain the current accepted version as its
fallback. The rollback drill will then move the alias between two known-good immutable versions,
prove public routing remains unchanged, run health/access/owner-isolation checks, restore the
current version in `finally`, and finish with zero drift. Until that evidence exists, rollback
remains open and no gateway cutover is authorized.

## Remaining gates

- Complete the remaining API failure and boundary matrix and publish the next meaningful accepted
  gateway release.
- Exercise fail-safe alias rollback/recovery between two known-good versions.
- Implement and accept SQS/outbox recovery and Lambda durable workflows.
- Repeat the replacement acceptance in isolated synthetic staging before any development cutover.

## Subsequent outcome

Two accepted immutable versions later passed the controlled `3 → 2 → 3` drill, restoration,
healthy-alarm/error inspection, context cleanup, and zero-drift gates. See the
[completed rollback evidence](d0-development-gateway-lambda-alias-rollback-2026-08-02.md).
