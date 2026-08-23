# D1 private-feature deployed acceptance foundation — 2026-08-23

## Outcome

Implemented and deployed the owner-local generated-synthetic fixture boundary needed to exercise
saved-job and conservative Matching reads in development. The corrected exact source was published
as a deterministic scanned migration image and immutable gateway bundle. A bounded deployed run
proved owner isolation, the conservative explanation contract, exact reverse cleanup, healthy
gateway alarms, zero active tasks, and final Terraform zero drift.

## Ownership and cleanup boundary

- Profile owns creation and exact cleanup of two synthetic identities and the owner's one bounded
  preference set.
- Jobs retains ownership of the existing three-job search fixture. Its public search response is the
  only handoff used to populate the saved-job snapshot.
- Matching owns creation and exact cleanup of one synthetic saved association and its list revision.
- The setup path intentionally creates no idempotency or append-only audit record because it is test
  setup rather than an API mutation. Preparation and cleanup both fail closed if those records or
  any unrelated rows appear inside the claimed owner boundary.
- Both runners emit aggregate counts only and replace failures with a fixed value-free message.

This preserves the service/schema ownership accepted by ADR-003 and avoids a privileged
cross-schema fixture writer.

## Local verification

- Profile: 17 tests passed with five opt-in integration skips; typecheck and build passed.
- Matching: 79 tests passed with five opt-in integration skips; typecheck and build passed.
- The deterministic migration-image publisher guard test passed and now requires both owner-local
  runner entrypoints in its package and runtime smoke checks.
- Repository formatting and changed-line whitespace checks passed.

## Deployed acceptance

- Exact source `fe68a8947ee1504099d8cbde867b83ab845b75f6` was published as a deterministic
  Linux/AMD64 migration image with immutable ECR readback and a complete zero-High/zero-Critical
  scan. The existing idle migration task definition was not changed; the acceptance operator
  registered a temporary exact-image clone and deregistered it during cleanup.
- The same source was reproducibly packaged into four immutable, versioned, customer-KMS-encrypted
  gateway objects. Saved plan SHA-256
  `93957d628384e2b3127a01f7e6084ebfe82ca5fbc5b7d80a55b5cca4e1f75687` changed only the
  gateway function and its unweighted alias. Development advanced to state serial `146` and exact
  numeric gateway alias `29`.
- The direct gateway boundary passed all 24 cases against the exact published bundle.
- The wholly fresh private-feature run returned one saved job for the owner and zero for the other
  identity. The owner's assessment returned `review_required` with nine grounded evidence items;
  the identity without preferences returned the exact HTTP `409` boundary.
- Matching, Profile, and Jobs cleanup completed in reverse ownership order with zero persistent
  fixture rows. The temporary task definition was deregistered and zero database tasks remained.
- All three gateway alarms were healthy. Refresh-backed plan SHA-256
  `6f7c8532ec17bc4f98439d040be1e7c86231f5d040696653dc38dcce1f3eff43` contains zero
  resource changes at state serial `146`.

Managed OIDC/API Gateway/browser, representative load, human accessibility, independent
security/privacy, and broader product acceptance remain separate Phase 1 gates.

## Deployed diagnostic and correction

The first bounded deployed attempts proved the saved-job owner projection and cross-owner empty
read, then consistently returned the stable `match_assessment_unavailable` response. Every attempt
completed exact reverse cleanup, left zero active tasks, and deregistered its temporary task
revision. A value-free staged diagnostic proved the Profile preference projection was exact and
isolated the failure to a JavaScript `TypeError` in the Jobs matchable reader.

The reader assumed the computed PostgreSQL `eligibleThrough` expression was always a JavaScript
`Date`. The deployed driver boundary can return its canonical timestamp string instead. Source now
uses the Jobs reader's existing strict timestamp normalizer before producing the public ISO value
and explicitly types that database field as `Date | string`. A regression exercises the raw-string
row shape. Jobs now passes 59/59 unit tests, typecheck, and build; repository formatting and
changed-line checks pass. The correction is published in both the exact acceptance image and live
gateway alias `29`. The fresh deployed run above accepts the corrected Jobs reader through the
saved-job/Matching composition and exact cleanup boundary.
