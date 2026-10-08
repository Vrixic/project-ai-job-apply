# Native material availability — 2026-10-07

Backend source extends the existing native HTTPS transport with bodyless HEAD availability and
composes it into both Gateway entry points. Nothing is published, deployed or activated.

## Behavior

- Native HEAD authenticates the original candidate, proves the current packet before and after a
  held memory read, revalidates the original lease and expiry, then returns 204 with the exact
  scalar material reference. It does not serialize the generated preview or render a file.
- Gateway approval, submission start/manual start and dispatch supply credentials only after
  identity resolution. Async-local owner/application scope isolates concurrent requests and clears
  the token when the call finishes. No background credential cache or token persistence exists.
- The client resolves the owner-issued allocation, pins the approved hostname and HTTPS port 8443,
  verifies TLS 1.3, sends HEAD only, does not follow redirects, and accepts only a matching bounded
  reference with empty response framing. Lookup/request is bounded to eight seconds. Gates and
  original expiry are checked again before returning. Transport failures remain unavailable.
- `NATIVE_MATERIAL_AVAILABILITY_ENABLED` defaults off. Activation requires packet protection,
  native authorization/locations and matching pinned host configuration. Terraform also requires
  explicit private application networking/NAT and matching task groups; it admits the provisioned
  NAT source addresses to native port 8443. No network has been applied.
- This is point-in-time availability, not a transferable lease or permission to submit. Actual
  handoff must hold/revalidate its content lease. Cancellation/logout/terminal disposal remains
  a separate unfinished owner-control composition; no disposal certificate is fabricated.

## Verification

Based on `260e99df`, Windows Node 24/pnpm 10 plus disposable network-isolated Linux Node 24.
Synthetic candidate authentication, owner proofs, TLS certificate and DNS mapping; no live OIDC,
provider calls, cloud infrastructure, candidate data or browser acceptance.

- Gateway build and all 38 workspace typecheck tasks passed (29 cached).
- Lint passed with the existing 15 warnings/58 informational notes and zero errors.
- 259 Gateway regressions passed, three existing skips; the final availability suite passes
  12 cases, including request isolation, detached work, lookup timeout, gate withdrawal,
  foreign owner/application, wrong host/reference, redirects and body framing.
- Terraform candidate configuration/native read network: 21 cases passed with mocked AWS.
- Final actual Linux transport/process suite: 42 cases passed, including the production Gateway
  client over real TLS to native memory, bodyless HEAD, foreign/absent auth, wrong paths, changed
  packet, terminal state and owner outages. The client test uses only a synthetic DNS mapping and
  test CA; its production TLS/HEAD/reference validation code runs unchanged.
- An intermediate run concurrent with workspace compilation passed 41 cases but exceeded the
  existing process-retirement elapsed-time assertion in one case. The unchanged suite then passed
  all 42 in isolation; no timeout/assertion was weakened. Logs:
  `.tmp/native-material-availability-linux-final.log` (intermediate) and
  `.tmp/native-material-availability-linux-isolated.log` (final).
- Formatting passed across 1,306 files.

The test containers were removed and Docker Desktop/WSL stopped after verification.

The existing repository-wide verifier stopped in candidate-rights session fixtures with
`EADDRINUSE 127.0.0.1:3000`; the already-running development server was preserved.
Log: `.tmp/native-cover-letter-intake-verify.log`. This is not a full verification pass.

## Remaining acceptance

Combined real database/native approval now passes for both material types:
[approval evidence](d3-native-postgresql-approval-2026-10-07.md#tailored-resume-and-packet-replacement).
Terminal application cleanup and the refreshed Gateway artifact have separate
[local evidence](d3-native-application-disposal-2026-10-07.md). Logout still needs the web sign-out
hook and backend admission withdrawal/positive original-task retirement integration. It must
prevent previously queued preparation from recreating material after logout, preserve ambiguous
submission state, and not represent a stop acknowledgement as completed retirement. The current
backend-only scope remains in force while the web-hook scope question is pending.
Managed/client/ATS acceptance remains. ADR-040 remains Proposed.
D1/D3 remain In progress. CI/CD stays deferred and the PC remains on.

## Refreshed native images

Both Linux amd64 images were built locally from frozen runtime source
`18698f7f3232e6b3c626069f8057ddab1c496302`. The source label and non-root user
`65532:65532` were independently inspected. Builds may reuse unchanged layers; this is not a
reproducibility or vulnerability-clearance claim. Configuration remains default-disabled.

| Image | Inspected immutable ID |
| --- | --- |
| Cover letter | `sha256:8fff8a03841e8951ccdf0e3a2d317a739c584b069a9ab41027820bc48f1b722f` |
| Tailored resume | `sha256:f728e767ca06cc056cdfff2ed44d44868e8a57791abff3fcda31f28489758e92` |

Updated runtime fixtures assert authenticated HEAD returns 204, zero body bytes, no-store and
the exact original scalar reference. The cover-letter sealed-read case also refuses HEAD.
The image runners exercise the image-owned runtime rather than replacing it with workspace code.

- `verify-native-material-image.mjs`: all five scenarios pass: normal, sealed read,
  second generation, secret refusal and TLS refusal.
- `verify-native-resume-image.mjs`: 24 assertions pass, including two actual rendered files,
  authenticated HEAD and original process retirement (exit 137, OOMKilled false).
- `verify-native-memory-session.mjs`: all 42 Linux process/transport cases pass in isolation
  in 126.7 seconds with the updated fixtures; no timing thresholds changed.

Logs: `.tmp/native-material-18698f7f-proof.log` and
`.tmp/native-resume-18698f7f-proof.log`. Tests use real local TLS/rendering and synthetic external
ports in isolated containers. No live OIDC, provider, managed task or browser behavior is claimed.
Nothing was published, deployed or activated.
The shared suite log is `.tmp/native-head-18698f7f-linux.log`. Fixture formatting/lint and
`git diff --check` pass. Docker Desktop and WSL are stopped after the checks; the PC stays on.
