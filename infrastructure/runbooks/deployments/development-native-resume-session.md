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

When the image pins numeric owner/source RPC versions, publish their enabled configuration with
new launches, dispatch scheduling and candidate preparation intake off. Verify the actual pinned
versions, code and deployment bindings before separately enabling intake and launches. A planned
version number is not evidence that the recipient exists. Keep dispatch scheduling off until all
recipient, IAM and qualified invoke-permission updates have settled; enable it with a separate
rule-only plan. If source import is needed, verify the processor's exact numeric parser recipient
and code hash, rather than the parser alias, before enabling scan-event delivery. Include active
observation, route and cleanup maintenance, and any global-runtime recovery rules, in the final
shutdown drain.

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
{"action":"coverLetter"}
{"action":"coverLetterStatus"}
{"action":"coverLetterPreview"}
{"action":"coverLetterDownload"}
{"action":"coverLetterExpiry"}
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
presence. `download` reads the resume PDF directly into memory (a generated resume is a PDF only) and verifies its format, media
type, header, canonical base64, byte count, file digest and original material binding. It emits
only format/size/digest evidence and does not save files. This is a backend transport check,
not a browser CORS or document layout acceptance test.

## Cover letters (ADR-059)

After `prepare`, the same session can exercise the live cover-letter path with the disposable account:

- `coverLetter` sends the explicit, acknowledged request the web workspace sends (the exact
  `bedrock-cover-letter.v1` notice). It is sent once with its own idempotency key; repeating the command does not
  send it again.
- `coverLetterStatus` reads the preparation: `queued`, `running`, `succeeded`, or `failed` with its error code. With
  the live switch off or the model refused, expect `failed` with `generation_unavailable` at once.
- `coverLetterPreview` reads the letter from the native host and reports only metadata: the status, packet match,
  paragraph count, the model that wrote it (`bedrock` and the profile id), the prompt version and the time left. It
  never prints the letter. The read is bound to the generation by content hash, document id and version.
- `coverLetterDownload` verifies the PDF and DOCX in memory, as `download` does.
- `coverLetterExpiry` reports `native-cover-letter-not-yet-expired` until thirty minutes after completion, then probes
  the Gateway location and the native host and reports `native-cover-letter-expired-unavailable` only when the
  Gateway issues no location (a 4xx) and the native read cannot succeed. A 5xx, a still-issued location or an answering
  host is `native-cover-letter-expiry-not-proven`. It needs an earlier verified preview or download, because that read
  fixes the expiry it is measured against.

The default session closes twenty minutes after confirmation, which is before a cover letter expires. To observe the
expiry, start with `--hold-for-expiry`: the session then closes after 45 minutes instead. The access token's own
expiry still binds, so confirm the token outlives the letter's thirty minutes (about 31 minutes after the preview) before
relying on it; otherwise the command reports an expired session. Run `coverLetterExpiry` after the thirty minutes, then
`withdraw`.

Always request `withdraw` after preparation and read `withdrawal` until `native_tasks_settled`.
The original withdrawal UUIDv7 is reused on retries. Withdrawal affects prior native materials
owned by this disposable account; it does not delete the account or change submission status.
The command does not submit to employers. `native_tasks_settled` proves only the API's native
task cleanup result, not provider/all-copy disposal or the independent AWS shutdown gate.

The operator permits one command at a time, refuses redirects, bounds response size and time,
and validates API response schemas. It closes at the earlier of token expiry or twenty minutes
after confirmation (45 minutes with `--hold-for-expiry`). Cancel, terminal EOF and termination signals close the credential session
after any in-flight command finishes. Closing is not automatic material cleanup. If output
reports `recoveryRequired`, retain the withdrawal request ID as private operational metadata;
finish owner-scoped cleanup through a fresh disposable session and independently reconcile native
tasks before removing their network paths. A new withdrawal request covers earlier materials.
Never interpret a failed or timed-out write as proof that nothing changed.

This driver covers authenticated prerequisites, packet preparation, direct native preview and
file transfer, the cover-letter request, status, preview, files and API-level expiry, and withdrawal.
Task retirement and AWS-side disposal evidence, rendered document quality,
actual browser behavior and live end-to-end acceptance remain required checks. Simulated test
results are not evidence that the managed runtime works.

After testing, complete [prelaunch shutdown](development-prelaunch-shutdown.md) and
[data-preserving database dormancy](development-database-dormancy.md), verify the resulting AWS
state and report retained charges. Keep the owner's PC on.
