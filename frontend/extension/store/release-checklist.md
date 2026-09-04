# Store release checklist and versioning policy

Every box applies independently to Chrome and Edge unless the evidence explicitly covers both.

## Repository and archive

- [ ] Package version is a new monotonically increasing numeric browser version and matches the
  generated manifest, listing record, and release evidence.
- [ ] `release:package` succeeds twice from the same commit and produces the same archive SHA-256.
- [ ] The release manifest contains only the ten allowlisted files and every digest is reviewed.
- [ ] Manifest permissions, CSP, service worker, side panel, absence of remote code/source maps,
  and absence of default-dark host permissions match `release-policy.v1.json`.
- [ ] No secret, token, raw fixture, production PII, `.env` value, or unrelated build output exists
  in the ZIP.
- [ ] Archive commit, dependency lock digest, tool versions, signer, and immutable evidence location
  are recorded outside the archive.

## Product, privacy, and operations

- [ ] Authorized provider fixtures and independent variant acceptance exist for every enabled rule.
- [ ] `EXTENSION_DETECTOR_ACTIVATION_JSON` contains only the reviewed exact extension version and
  complete provider/variant/domain maps; enabled tuples match accepted fixtures, and the archive
  still contains no persistent provider host permission.
- [ ] Dedicated extension Auth0 Native Application passes Chrome/Edge PKCE, rotation/replay,
  cancellation, sign-out, and revocation tests.
- [ ] Contribution API, command-authorization receipt binding, Trust review, withdrawal,
  deletion/export, takedown, and restoration behavior pass deployed owner/cross-owner tests. The
  backward-compatible private-capture API is tested separately and is not presented by this
  extension candidate.
- [x] Local stopped/all-item removal, logout clearing, and fail-closed expiry enforcement are implemented.
- [ ] The accountable local pending-item retention duration is approved and configured.
- [ ] The accountable UGC policy version is approved, recorded once, and configured identically as
  server `UGC_CONTRIBUTION_POLICY_VERSION` and extension
  `EXTENSION_UGC_CONTRIBUTION_POLICY_VERSION`; source provides no default.
- [ ] The exact Ed25519 capability-policy key IDs and base64url DER SPKI public keys are approved,
  rotated in a tested overlap window, and pinned through
  `EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON`; the default-dark archive contains no live key.
- [ ] Installed-browser tests prove global, exact client-version, provider, variant, and domain
  disable independently; invalid/stale/tampered/unknown-key updates deny, a verified offline cache
  lasts no longer than its signed expiry, and web/catalog remain available.
- [ ] Permission rationale, user-data form, privacy notice, subprocessor register, support/removal
  channels, screenshots, and listing copy match the exact binary and deployed endpoints.
- [ ] Accessibility, keyboard/zoom/screen-reader, malicious-page, offline/restart, update, rollback,
  kill-switch, load/abuse, alert, and incident-response evidence passes.
- [ ] Product owner and accountable security/privacy/legal reviewers accept the exact candidate.
- [ ] Chrome Web Store and Microsoft Edge Add-ons review approve the submitted candidate.

## Versioning

- `package.json` is the source for the numeric Manifest V3 version. Published versions are immutable
  and never reused, even after rejection or rollback.
- Patch: disclosure-neutral defect or assurance fix with no permission/data-flow expansion.
- Minor: additive user-facing capability within the approved permission/data boundary.
- Major: incompatible workflow or data/permission boundary requiring renewed accountable review.
- Any permission, host, data category, retention, provider variant, identity tenant, API origin,
  remote dependency, or store-copy change requires a new archive and full delta review regardless
  of semantic-version label.
- Emergency rollback publishes a new higher version with the affected capability disabled; it does
  not reuse or mutate a prior store artifact.
- The server may also issue a newly signed disable policy. A received valid disable takes effect
  before delivery; transport failure never extends a verified cache beyond its signed expiry.

This checklist records evidence; checking it does not itself confer accountable or store approval.
