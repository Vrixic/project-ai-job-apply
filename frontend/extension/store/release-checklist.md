# Store release checklist and versioning policy

Every box applies independently to Chrome and Edge unless the evidence explicitly covers both.

## Repository and archive

- [ ] Package version is a new monotonically increasing numeric browser version and matches the
  generated manifest, listing record, and release evidence.
- [ ] `release:package` succeeds twice from the same commit and produces the same archive SHA-256.
- [ ] The release manifest contains only the six allowlisted files and every digest is reviewed.
- [ ] Manifest permissions, CSP, service worker, side panel, absence of remote code/source maps,
  and absence of default-dark host permissions match `release-policy.v1.json`.
- [ ] No secret, token, raw fixture, production PII, `.env` value, or unrelated build output exists
  in the ZIP.
- [ ] Archive commit, dependency lock digest, tool versions, signer, and immutable evidence location
  are recorded outside the archive.

## Product, privacy, and operations

- [ ] Authorized provider fixtures and independent variant acceptance exist for every enabled rule.
- [ ] Dedicated extension Auth0 Native Application passes Chrome/Edge PKCE, rotation/replay,
  cancellation, sign-out, and revocation tests.
- [ ] Private-save and contribution APIs, consent binding, Trust review, withdrawal, deletion/export,
  takedown, and restoration behavior pass deployed owner/cross-owner tests.
- [x] Local stopped/all-item removal, logout clearing, and fail-closed expiry enforcement are implemented.
- [ ] The accountable local pending-item retention duration is approved and configured.
- [ ] The accountable UGC policy version is approved, recorded once, and configured identically as
  server `UGC_CONTRIBUTION_POLICY_VERSION` and extension
  `EXTENSION_UGC_CONTRIBUTION_POLICY_VERSION`; source provides no default.
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

This checklist records evidence; checking it does not itself confer accountable or store approval.
