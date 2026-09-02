# Permission rationale — draft

Status: repository source for a synthetic/default-dark candidate; accountable and store approval
pending.

| Permission | User-facing purpose | Trigger and boundary |
|---|---|---|
| `activeTab` | Temporarily inspect the public job page the user selected. | Granted only after an explicit user action; no persistent host access. |
| `scripting` | Run the bundled structured-field reader in that selected tab. | Executes only on the active tab after **Inspect current tab**; no persistent content script or remote code. |
| `identity` | Open the system-browser Auth0 authorization-code + PKCE flow. | Used only for explicit sign-in, refresh, revocation, and sign-out actions. The extension is a public client and has no client secret. |
| `storage` | Keep trusted-session authentication state and a bounded sanitized delivery queue. | Tokens and last capture use trusted `storage.session`; pending sanitized intents use `storage.local` so a worker restart does not lose them. |
| `alarms` | Resume bounded retry after Manifest V3 worker suspension. | Schedules only the next pending delivery attempt; it does not inspect pages or run periodic browsing collection. |
| `sidePanel` | Provide the same review and approval interface as the popup. | No additional data access. |

The generated default-dark archive must contain no host permission. A future configured candidate
would need only the exact reviewed HTTPS Auth0 tenant and API origin. Any such candidate is a new
release artifact and must repeat review; wildcard providers, `<all_urls>`, `history`, `cookies`,
`webRequest`, persistent content scripts, and remote executable code are prohibited.

`tabs` is not requested. The temporary active-tab grant provides the selected tab context needed by
the explicit inspection action.
