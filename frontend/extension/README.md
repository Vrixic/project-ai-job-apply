# Browser Extension

The Manifest V3 Chrome/Edge extension provides explicit job saving/community contribution,
current-page job detection, application inspection, conservative autofill, user takeover, and
submission confirmation.

Phase 0 contains only a narrow public-client Auth0 conformance shell. It uses
`chrome.identity.launchWebAuthFlow`, authorization code with PKCE S256, an exact
`chromiumapp.org` callback, rotating refresh tokens held in `chrome.storage.session`, current-device
revocation, and provider logout. It never requests page access, injects content scripts, or renders
or logs tokens or claims.

## Current structure

- `entrypoints/` — Popup and background authentication worker.
- `lib/` — PKCE, configuration, and Auth0 protocol helpers.
- `static/` — Popup markup and styling copied into the loadable bundle.
- `tests/` — PKCE, callback, and fail-closed configuration tests.
- `build.mjs` — Environment-aware MV3 bundler and exact host-permission generator.

## Planned structure

- `entrypoints/` — Side panel and content scripts in addition to the current auth shell.
- `features/` — Job capture, contribution preview, autofill, and task handoff.
- `adapters/` — Thin browser bindings that consume `packages/ats-sdk`.
- `permissions/` — Optional-host permission and disclosure logic.
- `tests/` — Additional MV3, permission, privacy, fixture, and end-to-end tests.

## Development conformance

Create a separate Auth0 Native Application for this public client. The extension has no client
secret. Copy `.env.example` to `.env.local`, set the public tenant domain and client ID, then run:

```powershell
pnpm --filter @ai-job-apply/extension build
```

Load `frontend/extension/dist` as an unpacked extension and copy the generated extension ID. Its
exact callback and logout URL is:

```text
https://EXTENSION_ID.chromiumapp.org/auth0
```

Register that URL in the development application's Allowed Callback URLs and Allowed Logout URLs,
rebuild, then use the popup to test login, credential renewal, cancellation, and logout. The
generated `dist/manifest.json` grants `identity`, `storage`, and only the exact configured Auth0
tenant host. A build without valid public configuration remains loadable but fails closed.

The extension must request minimum permissions, run collection only for disclosed user-facing
actions, and never upload unrelated browsing history, cookies, or form data.
