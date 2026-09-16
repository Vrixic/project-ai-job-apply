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
Chrome and Edge installed-browser evidence, authorized provider fixtures, a monitored support
channel, an accountably selected and identically configured UGC policy version, final listing
assets, and browser-store review remain external gates. The source `/extension-support` route is
hosted and accepted at `https://ai-job-apply-candidate.vercel.app/extension-support`; that does not
constitute a monitored support-channel or store-readiness claim. D2-073 updates the source copy
to exclude development-only diagnostic-panel instructions; source `cd896b2` is hosted and verified
on 2026-09-16. End-user archives omit both diagnostic panels, and packaging rejects their presence.

The default-dark archive pins no contribution capability signing key. A release candidate that can
receive signed capability data must embed only the accountably approved Ed25519 public-key mapping;
the policy remains inert JSON data, is accepted for at most 24 hours, and cannot load executable
code. Packaging rejects remote JavaScript import/worker construction and dynamic code construction
in addition to the manifest, CSP, and host-permission checks.

Detector activation is a separate reviewed build-time data object. It cannot carry code or add host
permissions, must bind the exact package version/provider/variant/domain tuple, and does not enable
public contribution. The default-dark archive injects no detector policy.

## Candidate icon provenance

The manifest and toolbar action use the same stripped transparent PNG mark at 16, 32, 48, and 128
pixels. The original concept was generated with OpenAI's built-in image-generation tool on
2026-09-04, then reduced to a document, one forward path, and a receiving catalog in forest green,
warm off-white, and muted sage. The generation prompt prohibited text, third-party/browser marks,
people, padlocks, resumes, briefcases, photography, and watermarks. ImageMagick 7 produced the four
committed square sRGB derivatives with metadata removed. The release validator checks their PNG
signature and exact dimensions, and the manifest/release policy must map all four sizes exactly.

This is an original candidate asset, not final product-owner or browser-store artwork approval.
The same restrained mark anchors the text-free 440-by-280-pixel small promotional tile and the
transparent 300-by-300-pixel Edge listing logo under `store/assets/`. The repository validator
requires exactly those two regular PNG files, checks every PNG chunk checksum, rejects embedded
text/EXIF metadata and trailing data, and enforces the exact dimensions, color boundary, and size
limit. These dimensions follow the current
[Chrome Web Store image specification](https://developer.chrome.com/docs/webstore/images) and
[Microsoft Edge Add-ons listing specification](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).

Product-owner artwork approval and exact installed screenshots remain open.
