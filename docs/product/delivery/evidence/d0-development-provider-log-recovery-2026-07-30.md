# D0 Development Provider And Log Recovery — 2026-07-30

## Result

- Status: Passed in isolated deployed development
- Data boundary: Synthetic accounts and synthetic preferences only
- Region: `us-east-2`
- Source: merged `main` at `5d6a716`
- Reviewed plan SHA-256:
  `8F2217FF1AA6C6D9B881D15A10DA9C4D931217748062B388872214773F5E35C7`

This record closes the web-focused D0-010 provider/log-stream recovery gate. It retains only UTC
timestamps, counts, state transitions, HTTP classes, and sanitized outcomes. It contains no
account, tenant, application, connection, user, role, log-stream, alarm-notification, token,
authenticator, recovery-code, preference, operation, task, image-digest, or provider-log
identifier.

## Merged release and reviewed apply

- [PR #32](https://github.com/Vrixic/project-ai-job-apply/pull/32) added fixed
  privacy-safe gateway/worker heartbeats, missing-signal alarms, dashboard visibility, the exact
  reversible gateway-log operator, and the separate Auth0 procedure.
- The [immutable image publication run](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30571379595)
  published both application images from the merged heartbeat release. Both encrypted immutable
  repositories reported complete scans with zero critical and zero high findings.
- The first nine-resource plan was rejected without apply because the two task-definition
  replacements ordered destruction before creation.
- [PR #33](https://github.com/Vrixic/project-ai-job-apply/pull/33) required
  `create_before_destroy` for gateway, worker, and migration task definitions.
- The final refresh-backed plan from clean merged `main` contained exactly four creates, three
  in-place updates, and two `create → delete` task-definition replacements across the expected
  nine addresses, with zero standalone deletes. The approved checksum above was verified
  immediately before apply.
- Apply completed with six provider-level creates, three changes, and two old-revision
  deregistrations. No database, object store, queue, network, KMS key, managed secret, or migration
  changed.

Post-apply verification passed:

- gateway and worker each reached one desired, one running, zero pending, with one completed
  deployment;
- running gateway and worker images matched the approved digest-pinned inputs;
- Cloud Map had one healthy gateway registration with IPv4 and port attributes;
- live and readiness returned `200`, while an unauthenticated protected request returned a generic
  `401`;
- both heartbeat metrics reported data, both missing-heartbeat alarms were `OK`, and both ALARM and
  OK actions were configured;
- one gateway-start and one worker-start structured event were present in the controlled interval;
  and
- the final same-input refresh-backed Terraform plan returned exit code `0` with no drift.

## Gateway log-delivery exercise

The exact development operator temporarily denied only `logs:PutLogEvents` for the gateway
application stream prefix. The API remained healthy while the fixed gateway heartbeat became
absent. The operator removed the exact deny in its `finally` recovery path.

| Check | Sanitized result |
|---|---|
| Gateway transition to `ALARM` | `2026-07-30T19:25:32.907Z` |
| Gateway recovery to `OK` | `2026-07-30T19:27:32.906Z` |
| API availability during interruption | Live endpoint remained healthy |
| Service state after recovery | Two stable services |
| Worker isolation | Zero worker `ALARM` transitions during the drill |
| Recovery policy | Absent after recovery |
| Post-recovery error events | Zero in the inspected interval |
| Notification delivery | Product owner confirmed receipt of one gateway ALARM and one gateway OK notification |
| Post-exercise Terraform state | No drift |

The worker alarm's earlier initialization transition was outside the gateway exercise and is not
represented as a worker outage.

## Auth0 fresh-login interruption and recovery

The product owner retained an administrator session, disabled all connections for only the exact
development Regular Web Application, and used a fresh private browser transaction. Existing
sessions and previously issued tokens were not represented as revoked.

| Check | Sanitized result |
|---|---|
| Enabled connection count before interruption | `2` |
| Enabled connection count during interruption | `0` |
| Failed fresh login | `2026-07-30T20:30:47.713Z` |
| Failure presentation | Generic account-unavailable/blocked guidance; no provider detail or bypass |
| Runtime isolation | Both services stable; live/readiness `200`; both heartbeat alarms `OK` |
| Enabled connection count after restoration | `2` |
| First recovered passkey login | `2026-07-30T20:38:54.092Z` |
| Deployed-gateway passkey login | `2026-07-30T20:41:04.492Z` |
| Durable recovery result | Synthetic preference operation reached `succeeded` through the deployed gateway and worker |

The first successful recovery login exposed a local operator-routing mistake: the restarted web
client targeted the unavailable local API. The dedicated deployed-conformance launcher then
resolved the encrypted Terraform output process-locally, and the second fresh passkey transaction
completed the deployed durable path.

During diagnosis, a local search command printed the ignored development Auth0 client secret and
local session-encryption secret into the operator transcript. Testing stopped immediately. The
product owner rotated the Regular Web Application client secret in Auth0, regenerated the local
session secret through the repository's secure prompt, restarted the web client, and completed the
two successful transactions above using the replacement values. No secret value is retained here,
no secret entered source control, and no AWS credential or candidate data was involved. This is a
corrective-action record, not a claim that the Phase 0 incident-response program has independent
approval.

## Acceptance boundary

The exercise proves safe fresh-login failure and restoration for the development web application,
plus detection and recovery for the gateway log path. It does not prove total Auth0/JWKS outage,
revocation of existing sessions, CloudWatch regional isolation, production capacity, production
incident response, staging replay, extension conformance, mobile conformance, or accountable
security/privacy approval.

Extension provider conformance belongs to D2, mobile provider/device conformance belongs to D6,
and the applicable identity/deployment matrix must be replayed when isolated staging is activated.
