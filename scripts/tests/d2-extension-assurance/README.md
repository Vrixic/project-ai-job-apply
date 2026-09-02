# D2 Extension Release Assurance

This source-side verifier inspects the exact unpacked Manifest V3 output produced by the extension
build. It fails closed on undeclared or excessive permissions, persistent content scripts, broad
page access, remote executable-code hooks, unsafe CSP, source maps, credential-like material, and a
missing default-dark capability marker.

Run from the repository root:

```powershell
pnpm test:d2-extension-assurance
```

`pnpm --filter @ai-job-apply/extension test:browser` launches the unpacked extension in a fresh
persistent Edge/Chromium profile against loopback-only malicious synthetic provider pages. The
harness aborts every external request, deletes its profile, and emits aggregate metrics only.

The installed-browser profile executes MV3 loading, background-worker startup, exact permission
denial, three malicious loopback fixtures, keyboard focus, 200% zoom/reflow, storage leakage, and
zero-network/zero-telemetry checks. Deterministic extension unit tests separately cover worker
restart cache restoration, offline queue/retry, cancellation and logout/account fencing, signed
kill-switch isolation, sanitization, and provider/variant/domain rejection. Those source-level
tests are not reported as browser-executed behavior.

The verifier retains aggregate counts and file names only. It does not print configured Auth0/API
hosts, inspect `.env.local`, contact a provider, install the extension, or claim Chrome Web Store,
human accessibility, managed-OIDC, provider-fixture, or deployed acceptance. Those remain separate
D2 gates.
