# Phase 0 Incident Response

## Boundary

This runbook covers the development and synthetic-staging foundation: Auth0 sessions, API
Gateway/Lambda, SQS and dead-letter queues, Lambda durable executions, PostgreSQL, KMS, Secrets
Manager, S3 artifacts, logs, alarms, GitHub deployment identity, and the retained on-demand
migration task. It does not authorize testing against production, collecting candidate content in
incident tools, or bypassing authentication, CAPTCHA, MFA, provider controls, or final review.

## Roles and channels

Before real candidate data is processed, fill these values in the restricted incident system—not
in this repository:

| Role or channel | Requirement |
|---|---|
| Incident commander | One named person with authority to contain the affected capability |
| Technical lead | Owner of the affected application or cloud boundary |
| Privacy/legal escalation | Accountable contact for notification and evidence-handling decisions |
| Internal intake | Monitored, access-controlled channel with an immutable timeline |
| External security contact | Monitored address or reporting service published before launch |

If the incident commander is unavailable, stop external side effects and escalate to the product
owner. Do not continue risky operation merely to preserve availability.

## Severity

Choose the highest applicable level and record why:

| Severity | Examples | Initial posture |
|---|---|---|
| Critical | Confirmed cross-user disclosure; privileged compromise; uncontrolled application submission; broad restricted-data exposure | Disable the affected path immediately; revoke credentials/sessions; engage privacy/legal escalation |
| High | Credible account takeover; secret exposure; authorization bypass without confirmed exploitation; durable work producing incorrect effects | Isolate the path, stop affected triggers, preserve evidence, and begin reconciliation |
| Medium | Contained availability/integrity failure; bounded abuse; control degradation with a safe workaround | Limit scope, restore the control, and monitor for escalation |
| Low | No candidate impact and no security boundary failure; minor operational defect | Track through normal corrective action with an owner |

Any uncertainty about cross-user access, restricted data, or an irreversible external action is
handled at least as High until evidence narrows the scope.

## Response sequence

1. **Open the timeline.** Record UTC discovery time, reporter, affected environment, symptoms,
   suspected exposure class, and the person assuming incident command. Use opaque correlation IDs,
   not candidate content or credentials.
2. **Protect people and evidence.** Stop log exports, screenshots, or debugging that may spread
   sensitive values. Preserve relevant immutable deployment versions, aggregate log windows,
   CloudTrail references, alarm transitions, queue depth, and workflow IDs in the restricted
   incident system.
3. **Contain the narrowest safe boundary.** Depending on the failure, disable the API route or
   durable trigger, set affected concurrency to zero, revoke Auth0 sessions/credentials, rotate or
   revoke a secret, quarantine an artifact, restrict IAM/network access, or roll the alias back to
   a known-good immutable version. Do not delete queues, database records, logs, or backups during
   containment.
4. **Determine scope.** Identify first/last known occurrence, environments, identities, objects,
   actions, providers, and data classes. Test anonymous, wrong-environment, revoked, candidate A,
   and candidate B boundaries with synthetic identities where relevant.
5. **Eradicate and recover.** Correct the root cause through reviewed source and an immutable
   release. Follow the current [serverless release](../deployments/serverless-application-release.md),
   [database migration](../deployments/database-migration.md), or environment restore procedure.
   Re-enable triggers and routes only after health, authorization, persistence, alarms, and zero
   drift pass.
6. **Reconcile durable work.** Account for every affected outbox row, SQS message, DLQ message,
   durable execution, candidate operation, deletion/export request, and external side effect.
   Never replay an ambiguous irreversible action without renewed candidate review.
7. **Make notification decisions.** The privacy/legal contact determines notification duties from
   affected people, data, jurisdictions, contracts, and timing. Engineering does not make or waive
   that legal conclusion.
8. **Close with evidence.** Record root cause, impact, containment/recovery times, corrective
   actions, owners, due dates, residual risk, reviewer disposition, and the controls retested.

## Minimum recovery checks

- Exact Auth0 issuer/audience and anonymous `401` behavior pass.
- Authenticated preference persistence and cross-user operation denial pass.
- Durable readiness reaches a terminal success or a deliberately tested terminal failure.
- Queue/DLQ, Lambda error/throttle, API `5xx`, database, and heartbeat alarms are understood.
- No secrets, tokens, candidate values, or raw payloads appear in retained logs or evidence.
- Terraform reports no unexplained drift, and every running workload is expected.

## Exercise scenarios

Exercise these with synthetic identities before real candidate data or public launch:

1. stolen or blocked Auth0 account/session;
2. candidate A attempting to read candidate B's operation;
3. exposed provider or deployment credential;
4. unintended or ambiguous application submission;
5. poison message or durable execution repeatedly failing; and
6. database recovery with workflow reconciliation.

An exercise record must name participants and roles, timestamps, scenario, exact environment and
release, observed decisions, containment/recovery measurements, missing controls, corrective
owners, and retest disposition. Existing component conformance evidence may support the record but
does not by itself prove that a staffed incident exercise passed.
