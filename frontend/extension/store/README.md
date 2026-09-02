# Browser-store release materials

These files are repository-side drafts and reproducible-package controls for D2-009. They describe
the current synthetic, default-dark Manifest V3 candidate. They are **not** approval to publish,
enable provider detection, accept public contributions, or process real candidate data.

- [Permission rationale](permission-rationale.md)
- [User-data and privacy disclosure source](privacy-user-data-disclosure.md)
- [Store listing draft](store-listing-draft.md)
- [Support, withdrawal, and removal disclosure](support-and-removal.md)
- [Release checklist and versioning](release-checklist.md)
- `release-policy.v1.json` — machine-checked default-dark manifest and archive allowlist

`pnpm --filter @ai-job-apply/extension release:package` performs a clean fail-closed build, rejects
unexpected permissions/files, and writes a deterministic ZIP plus release manifest under
`frontend/extension/dist/release/`. Generated archives are ignored and must not be committed.

The package is intentionally not upload-ready. Accountable privacy/security/legal approval,
Chrome and Edge installed-browser evidence, authorized provider fixtures, working user removal and
support channels, final listing assets, and browser-store review remain external gates.
