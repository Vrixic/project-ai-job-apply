# Mobile Application

The React Native/Expo companion for iOS and Android. It supports discovery, saved jobs,
notifications, application packet review/approval, technical application history through confirmed
submission, profile corrections, and application-agent actions.

Phase 0 contains only a narrow Auth0 Native Application conformance shell. It proves Universal
Login through the system browser, authorization code with PKCE, secure credential persistence and
renewal through the Auth0 native SDK, cancellation, and logout. It deliberately contains no later
mobile product features and never renders or logs tokens or identity claims.

## Current structure

- `App.tsx` — fail-closed authentication conformance UI.
- `app.config.ts` — native identifiers and Auth0 Expo plugin configuration.
- `lib/` — validated public runtime configuration and sanitized auth error handling.
- `tests/` — configuration and privacy-boundary tests.

## Planned structure

- `app/` — Expo Router navigation and screens.
- `features/` — Mobile product modules.
- `components/` — Mobile-only composed UI.
- `native/` — Carefully isolated native integrations.
- `assets/` — Mobile images, fonts, and store assets.

## Development conformance

Copy `.env.example` to `.env.local`, set the development Native Application's public client ID and
tenant domain, then run:

```powershell
pnpm --filter @ai-job-apply/mobile android
```

The Auth0 React Native SDK requires a custom development build and does not run in Expo Go. Register
these exact callback and logout URLs in the development Native Application, substituting the
tenant domain:

```text
applydashdev://TENANT_DOMAIN/ios/com.vrix.applydash.dev/callback
applydashdev://TENANT_DOMAIN/android/com.vrix.applydash.dev/callback
```

The mobile application is a public client and has no client secret. Build-time environment values
are public configuration, not credentials. Do not place a web client secret, token, user data, or
production identifier in this folder.

Mobile does not inject into third-party ATS pages. It hands such tasks to the desktop extension or
monitors/approves an eligible remote workflow.
