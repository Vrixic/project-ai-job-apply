# Development Provider And Log Recovery

Use this procedure to prove the final Phase 0 managed-identity resilience gate in the dedicated,
synthetic AWS/Auth0 development environment. It contains two separate exercises because identity
provider availability and application-log delivery are independent failure domains.

## Evidence boundary

This procedure proves:

- a fresh web login cannot complete while every connection for the exact development web
  application is disabled;
- the application returns only a generic failure state and does not introduce a provider bypass;
- restoring the exact connection set restores fresh passkey login and an authenticated durable
  operation;
- gateway and worker heartbeats are continuously derived from KMS-encrypted structured logs;
- absence of the gateway heartbeat reaches `ALARM` while the live API remains healthy;
- removal of the exact temporary log-delivery deny returns the alarm to `OK`; and
- the worker log path, database, Temporal, application images, task counts, and candidate data are
  not changed by the log exercise.

The provider exercise is a fresh-login availability test. Existing provider sessions and already
issued access tokens may remain valid until their normal expiration, so do not describe it as
revocation or a total Auth0/JWKS outage. Automated verifier coverage separately proves warm-cache
JWKS behavior and cold-verifier fail-closed behavior.

Never retain tenant, connection, user, role, account, API, log-group, topic, alarm, token,
authenticator, recovery-code, preference, or operation identifiers. Record only UTC timestamps,
aggregate counts, HTTP classes, alarm transitions, stable-service counts, and pass/fail results.

## Preconditions

1. Use merged source, a clean checkout, Terraform `1.9.8`, and the temporary
   `ai-job-apply-development-admin` IAM Identity Center profile in `us-east-2`.
2. Require the heartbeat release and Terraform resources to be deployed from immutable,
   successfully scanned images; require a refresh-backed no-drift plan.
3. Run `pnpm --filter @ai-job-apply/observability test` and
   `pnpm --filter @ai-job-apply/auth test`.
4. Require gateway and worker at one desired, one running, zero pending, with completed primary
   deployments; require `/health/live` and `/health/ready` to return `200`.
5. Require both missing-heartbeat alarms in `OK`, both alert actions configured, and a confirmed
   operational-alert subscription.
6. Use only the disposable synthetic Auth0 user. Keep a separate, verified Auth0 administrator
   session open so the application connections can always be restored.
7. In Auth0, note the enabled connection names for the exact Regular Web Application in memory.
   Require at least one enabled connection and do not record the names in shared evidence.

Stop if any precondition fails. Do not start either exercise during a deployment, restore,
migration, secret rotation, another drill, or real-user activity.

## Exercise fresh Auth0 login interruption

Use a fresh private browser window so an existing application or Auth0 SSO session cannot satisfy
the test.

1. In Auth0 Dashboard, open **Applications > Applications**, select the exact development Regular
   Web Application, and open **Connections**.
2. Disable every currently enabled connection for this application only. Do not change tenant-wide
   connection settings, callback/logout URLs, grants, scopes, signing keys, the API, user state, or
   secrets.
3. From the fresh private window, begin web sign-in. Require that fresh authentication cannot
   complete and that no application session or protected API access is created. If control returns
   to the application, it must show only the allowlisted generic sign-in failure.
4. Confirm the deployed gateway remains live, both ECS services remain stable, and both log
   heartbeat alarms remain `OK`. Provider-login failure must not take down unrelated runtime
   capabilities.
5. Immediately re-enable exactly the connection set noted in the precondition. Do this even if the
   failure presentation is unexpected.
6. Open another fresh private window. Require passkey login to complete without a test bypass,
   save the synthetic preferences, and require the durable operation to reach `succeeded`.
7. Log out and close the synthetic browser sessions.

If the connections cannot be restored, stop all authentication testing and use the still-open
administrator session to restore only the exact prior application connection set. Do not create a
replacement client, rotate keys, or widen tenant settings as recovery.

## Exercise gateway log-delivery interruption

First run the read-only status:

```powershell
.\scripts\exercise-development-log-delivery.ps1
```

Require two stable services, a healthy gateway, heartbeat alarm `OK`, non-empty ALARM/OK actions,
and the drill policy absent. Then run:

```powershell
.\scripts\exercise-development-log-delivery.ps1 -Action Exercise -Execute
```

The script resolves the exact running gateway task execution role and KMS-encrypted application
log group without printing identifiers. It attaches one temporary inline explicit deny for only:

```text
logs:PutLogEvents
gateway/*
```

The worker, collector, and migration stream prefixes remain allowed. The script waits up to ten
minutes for the three-minute missing-heartbeat alarm, requires the API live endpoint to remain
healthy, removes the exact deny in a `finally` block, waits for `OK`, and rechecks both services.
The operator must confirm receipt of one sanitized ALARM notification and one sanitized OK
notification.

If the command is interrupted or recovery is uncertain, run:

```powershell
.\scripts\exercise-development-log-delivery.ps1 -Action Recover -Execute
```

`Recover` removes only the exact drill policy, waits for `OK`, and rechecks runtime health. Do not
detach the ECS execution managed policy, change the Terraform-managed secret policy, stop tasks,
force a deployment, or loosen CloudWatch/KMS/SNS controls.

## Acceptance

Record a single sanitized evidence file only after both exercises pass:

- provider failure and recovery UTC timestamps;
- initial and restored enabled-connection counts, not names;
- fresh login denied during interruption;
- generic application failure behavior, if the callback returned;
- fresh passkey login and durable operation passed after restoration;
- gateway log alarm `OK → ALARM → OK` timestamps;
- API remained live during log interruption;
- two stable services before and after;
- drill policy absent after recovery;
- ALARM and OK notifications received;
- worker heartbeat remained `OK`;
- zero unexpected error-level application events after recovery;
- no Terraform drift; and
- no restricted values retained.

Only then may the Auth0 conformance matrix and D0-010 provider/log-stream row be marked passed.
