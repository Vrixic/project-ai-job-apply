# Development Auth0 Recovery

Use this synthetic-only procedure to prove that fresh authentication fails closed during an Auth0
application-connection interruption and recovers after the exact prior connection set is restored.
The filename is retained because deployed CloudWatch descriptions link here; the retired ECS log
heartbeat exercise is intentionally not part of this current procedure.

## Preconditions

- Keep a separate verified Auth0 administrator session open.
- Use only disposable synthetic accounts and a fresh private browser window.
- Note the enabled connection names for the exact development Regular Web Application in memory;
  do not record them in shared evidence.
- Confirm the public API returns `200/200/401`, durable triggers are enabled, alarms are healthy,
  and no deployment or migration is active.

## Exercise

1. Disable every currently enabled connection for the exact development web application only.
2. Start a fresh login and require it to fail without creating an application session or exposing
   provider detail. The application may show only its generic sign-in failure.
3. Confirm the unrelated API health routes and durable triggers remain healthy.
4. Immediately restore exactly the prior connection set.
5. In another private window, require passkey login, preference persistence, and a succeeded
   readiness operation.
6. Log out and close synthetic sessions.

If restoration fails, use the preserved administrator session to restore only the exact prior
application connection set. Do not create a replacement client, weaken grants, or add a bypass.

Record only timestamps, aggregate connection counts, generic failure behavior, recovery result,
`200/200/401`, durable completion, and alarm state. Never retain connection, account, token,
authenticator, preference, or operation identifiers.
