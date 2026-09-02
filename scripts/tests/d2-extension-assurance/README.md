# D2 Extension Release Assurance

This source-side verifier inspects the exact unpacked Manifest V3 output produced by the extension
build. It fails closed on undeclared or excessive permissions, persistent content scripts, broad
page access, remote executable-code hooks, unsafe CSP, source maps, credential-like material, and a
missing default-dark capability marker.

Run from the repository root:

```powershell
pnpm test:d2-extension-assurance
```

The verifier retains aggregate counts and file names only. It does not print configured Auth0/API
hosts, inspect `.env.local`, contact a provider, install the extension, or claim Chrome Web Store,
human accessibility, managed-OIDC, provider-fixture, or deployed acceptance. Those remain separate
D2 gates.
