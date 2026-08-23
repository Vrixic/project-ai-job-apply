# D1 private-feature deployed acceptance foundation — 2026-08-23

## Outcome

Implemented the missing owner-local generated-synthetic fixture boundary needed to exercise the
already deployed saved-job and conservative Matching read paths in development. This is source and
local verification evidence only; no image was published, task definition changed, cloud task run,
or acceptance claim made at this checkpoint.

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

## Remaining acceptance sequence

1. Commit and publish the exact merged source as the deterministic scanned migration image.
2. Advance only the idle migration task definition to that immutable image.
3. Run Jobs prepare, Profile prepare, Matching prepare, direct authenticated gateway reads for owner
   isolation and the fixed conservative explanation, then Matching/Profile/Jobs cleanup.
4. Require zero claimed fixture rows, zero active ECS tasks, healthy alarms, and final Terraform zero
   drift before updating D1-005 deployment status.

Managed OIDC/API Gateway/browser, representative load, human accessibility, independent
security/privacy, and broader product acceptance remain separate Phase 1 gates.
