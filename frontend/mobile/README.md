# Mobile Application

The React Native/Expo companion for iOS and Android. It supports discovery, saved jobs, notifications, application packet review/approval, technical application history through confirmed submission, profile corrections, and application-agent actions.

## Planned subfolders

- `app/` — Expo Router navigation and screens.
- `features/` — Mobile product modules.
- `components/` — Mobile-only composed UI.
- `native/` — Carefully isolated native integrations.
- `lib/` — API, authentication, deep-link, and push helpers.
- `assets/` — Mobile images, fonts, and store assets.
- `tests/` — Unit, accessibility, and device-level tests.

Mobile does not inject into third-party ATS pages. It hands such tasks to the desktop extension or monitors/approves an eligible remote workflow.
