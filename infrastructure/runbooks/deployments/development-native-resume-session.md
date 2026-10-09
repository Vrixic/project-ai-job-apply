# Development native resume test session

This backend operator uses the existing loopback PKCE/fresh-MFA sign-in helper with a separate
native-resume purpose. Use only an owner-confirmed disposable account containing generated
synthetic data. It requests Applications scopes without changing the web application's settings
or reusing deletion/contribution test authority. Tokens remain in process memory, are never
accepted through stdin, and are not written to a file. No refresh token is accepted.

Before starting, prepare the bounded AWS test batch using the native deployment/lifecycle
runbooks. Restore and verify the development database and enable only the required original
release, routes and networking. This command does not start cloud resources. Keep AWS dormant
while preparing the test driver; do not sign in early and let the token expire during a restore.

Build the existing packages and start from the repository root:

```powershell
pnpm --filter @ai-job-apply/auth build
pnpm --filter @ai-job-apply/api-contracts build
node scripts/start-development-native-resume-session.mjs --check
node scripts/start-development-native-resume-session.mjs
```

The command reads the existing local web identity settings and verifies the configured
development issuer/audience, AWS account and exact Gateway name/ID/HTTPS endpoint using the
development SSO profile. `--check` performs only those read-only checks, without opening a sign-in
listener or changing cloud resources. It refuses another environment. Port 3000 must be free. Open its local
URL in a regular browser, complete sign-in/MFA yourself, and confirm the exact disposable
account on the local page. Do not automate Google sign-in or export browser cookies.

Once `native-session-ready` appears, stdin accepts only these JSON commands:

```json
{"action":"inspect"}
{"action":"prepare","jobId":"REPLACE_WITH_RETURNED_JOB_UUID"}
{"action":"preview"}
{"action":"download"}
{"action":"withdraw"}
{"action":"withdrawal"}
{"action":"cancel"}
```

`inspect` reports resume count and up to five public job IDs. It does not print resume names,
profile facts or job content. The account must already have a usable generated-synthetic source
resume. `prepare` creates or retrieves one application and prepares its packet without a cover
letter or restricted answers. It retains the same creation/preparation idempotency keys and
original revision on ambiguous retries. The session cannot select a second job. Successful
preparation is not repeated. `preview` refreshes the application's packet metadata, discovers
the original native location through Gateway, then reads the direct native HTTPS endpoint.
Only UUIDv7 hosts beneath the exact reviewed development material domain on port 8443 receive
the credential. Packet and generation metadata must match, including the original fixed expiry.
While asynchronous generation has not attached its reference, it reports `native-generation-not-ready`;
repeat the read, not preparation. `preview` reports only status, packet match and native material
presence. `download` reads PDF and DOCX directly into memory and verifies their format, media
type, header, canonical base64, byte count, file digest and original material binding. It emits
only format/size/digest evidence and does not save files. This is a backend transport check,
not a browser CORS or document layout acceptance test.

Always request `withdraw` after preparation and read `withdrawal` until `native_tasks_settled`.
The original withdrawal UUIDv7 is reused on retries. Withdrawal affects prior native materials
owned by this disposable account; it does not delete the account or change submission status.
The command does not submit to employers. `native_tasks_settled` proves only the API's native
task cleanup result, not provider/all-copy disposal or the independent AWS shutdown gate.

The operator permits one command at a time, refuses redirects, bounds response size and time,
and validates API response schemas. It closes at the earlier of token expiry or twenty minutes
after confirmation. Cancel, terminal EOF and termination signals close the credential session
after any in-flight command finishes. Closing is not automatic material cleanup. If output
reports `recoveryRequired`, retain the withdrawal request ID as private operational metadata;
finish owner-scoped cleanup through a fresh disposable session and independently reconcile native
tasks before removing their network paths. A new withdrawal request covers earlier materials.
Never interpret a failed or timed-out write as proof that nothing changed.

This driver covers authenticated prerequisites, packet preparation, direct native preview and
PDF/DOCX transfer, and withdrawal. Expiry/retirement observation, rendered document quality,
actual browser behavior and live end-to-end acceptance remain required checks. Simulated test
results are not evidence that the managed runtime works.

After testing, complete [prelaunch shutdown](development-prelaunch-shutdown.md) and
[data-preserving database dormancy](development-database-dormancy.md), verify the resulting AWS
state and report retained charges. Keep the owner's PC on.
