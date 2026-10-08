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

Complete combined real database/native approval and cleanup behavior, refresh native images and
Gateway artifacts, then obtain authorized managed/client/ATS acceptance. ADR-040 remains Proposed.
D1/D3 remain In progress. CI/CD stays deferred and the PC remains on.
