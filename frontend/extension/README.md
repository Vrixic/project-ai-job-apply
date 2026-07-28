# Browser Extension

The Manifest V3 Chrome/Edge extension provides explicit job saving/community contribution, current-page job detection, application inspection, conservative autofill, user takeover, and submission confirmation.

## Planned subfolders

- `entrypoints/` — Popup, side panel, background worker, and content scripts.
- `features/` — Job capture, contribution preview, autofill, and task handoff.
- `adapters/` — Thin browser bindings that consume `packages/ats-sdk`.
- `permissions/` — Optional-host permission and disclosure logic.
- `lib/` — Authenticated API, storage, messaging, and redaction helpers.
- `tests/` — MV3, permission, privacy, fixture, and end-to-end tests.

The extension must request minimum permissions, run collection only for disclosed user-facing actions, and never upload unrelated browsing history, cookies, or form data.
