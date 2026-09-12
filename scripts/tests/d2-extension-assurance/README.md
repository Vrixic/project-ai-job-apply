# D2 Extension Release Assurance

This source-side verifier inspects the exact unpacked Manifest V3 output produced by the extension
build. It fails closed on undeclared or excessive permissions, persistent content scripts, broad
page access, remote executable-code hooks, unsafe CSP, source maps, credential-like material, and a
missing default-dark capability marker.

Run from the repository root:

```powershell
pnpm test:d2-extension-assurance
```

`pnpm --filter @ai-job-apply/extension test:browser` launches the unpacked extension in fresh
persistent Microsoft Edge and Google Chrome for Testing profiles against loopback-only malicious
synthetic provider pages. The
harness aborts every external request, distinguishes an expected configured signed-policy fetch
from unexpected external or telemetry traffic, deletes its profile, and emits aggregate metrics
only.

The matrix discovers Edge from its standard Windows install and the newest local Playwright Chrome
for Testing binary. `D2_EXTENSION_EDGE_BROWSER` and `D2_EXTENSION_CHROME_FOR_TESTING` may pin exact
executables. The single-browser harness remains available as `test:browser:single` with
`D2_EXTENSION_BROWSER` and optional aggregate label `D2_EXTENSION_BROWSER_NAME`. Branded Chrome is
reserved for manual installed testing because current branded releases reject command-line unpacked
extension loading.

The installed-browser profile executes MV3 loading, background-worker startup, exact permission
denial, and three malicious loopback fixtures. It also renders the real popup module against
synthetic configured, unconfigured, long-value, and missing-value responses. Browser assertions
cover 320, 360, and 480 CSS-pixel side-panel layouts, 200% zoom/reflow, required-marker and control
geometry, semantic control names, keyboard focus and disclosures, selection and delivery live
regions, a fixed 448-pixel popup width (twice the original 224-pixel target), direct public-add delivery gating, absence
of private-save and redundant-consent controls, expandable long values, explicit unavailable
values, storage leakage, axe WCAG 2.0/2.1 A/AA scans on the popup and side panel, and
zero-allowed-network/zero-telemetry checks. Deterministic extension unit tests separately cover worker
restart cache restoration, offline queue/retry, cancellation and logout/account fencing, signed
kill-switch isolation, sanitization, and provider/variant/domain rejection. Those source-level
tests are not reported as browser-executed behavior.

The verifier retains aggregate counts and file names only. It does not print configured Auth0/API
hosts, inspect `.env.local`, contact a provider, install the extension, or claim Chrome Web Store,
human accessibility, managed-OIDC, provider-fixture, or deployed acceptance. Those remain separate
D2 gates.

## Generated provider-pairing regression

Run `pnpm test:d2-provider-pairing` for a separate generated-only browser-to-verifier check. It
uses the actual inspector/detector, selected public payload, Jobs normalizer, real provider
adapters with injected responses, and independent verifier. All browser requests are intercepted
or blocked and no provider, login, deployment, or workstation secret is used. This complements
the installed-extension matrix; it does not replace representative provider fixtures, live
account lifecycle, or activated end-to-end publication acceptance.

The same pairing runner includes a browser-free intake seam. Run it independently with
`node scripts/tests/d2-extension-assurance/contribution-intake.mjs`. It composes the current
sanitizer, selected-field request mapper, OpenAPI validator, and Jobs intake service with generated
consent/persistence ports. Generated limit, truncation, and residual-bracket cases plus both accepted
inert Lever fixture variants must reach the unchanged server checks. Unsafe optional fields are
omitted before preview approval; existing queued approvals remain unchanged and invalid payloads
still refuse before persistence. Source bundling stays in memory, emits aggregate results only,
and makes no network request or application-artifact write. This is local compatibility evidence,
not an installed-browser, live contribution, independent provider, or publication acceptance.
