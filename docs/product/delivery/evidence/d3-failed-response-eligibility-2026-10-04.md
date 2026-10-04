# D3-065 original-failure eligibility for response maintenance

Date: 2026-10-04
Scope: backend source and local synthetic verification only; D1/D3 remain In progress.
Current result: full exact-source local verification passes for `e071d9e`; five artifact sets
pass independent integrity and bundled refusal checks, unpublished. Review/merge/deployment remain.
Branch: `fix/d3-failed-response-eligibility`, created from fresh main `bde17d9`, then fast-forward
integrating exact open #534 head `10f196b` as an explicit dependency (which includes open #533).
Neither dependency is claimed GitHub-merged. Hosted CI/CD is deferred by owner until production launch.

## Problem and resulting behavior

The prior reconciler trusted a caller's failed/abandoned classification and fenced work before
checking inventory. A captured active generation could therefore be stopped by a misclassified
reference. The existing work ledger recorded settlement without its original cause; generic
cleanup fences and NULL settlements could not prove failure.

[Migration 0009](../../../../backend/services/documents/migrations/0009_cover_letter_provider_failure.sql)
adds nullable fixed `provider_failure` metadata without backfill. A separate immutable trigger
preserves the original trigger unchanged and allows proof only with an original provider
running-to-settled transition. Existing rows stay unclassified. Original output-rejection and
non-dispatch closures now commit proof, settlement and future fences atomically. Original
failed/cancelled/incomplete closure retains exact captured id/time and disposed-status checks.
A conflicting positive replay refuses; an old NULL settlement is never retrofitted.

[Owned readFailed](../../../../backend/services/documents/src/cover-letter-response-store.ts)
requires the exact original owned settled provider, pending document, positive captured response,
fixed failure reason and permanently revoked final authority. Completed rejected output can
qualify; non-dispatch and missing identity cannot. Disposed status must match original failure
(or completed for rejected completed output). Other private writers may still be running.

[Reconciliation](../../../../backend/services/documents/src/cover-letter-response-reconciliation.ts)
uses this read before fencing and again for durable disposal convergence. Missing ports, old
compositions, absent proof, generic fences, successful or active generation refuse before fence
or provider I/O. The private closed v1 disposal boundary adds `read_failed` with existing exact
numeric target, single-attempt, bounded receipt and action/reference echo checks. The existing
native default-off bootstrap supplies the owning read. No ordinary-inventory fallback.

This is not a classification of ambiguous abandoned work. Such work needs a separate owning
abandonment decision/drain protocol, not caller labels, elapsed time or guessed proof. No new
quiescence, writer settlement, renewal, dispatch or object/row purge authority is granted.

## Compatibility and rollout

Internal Documents operational metadata only; no candidate text, prompt, credential or provider
payload is stored. Public OpenAPI/domain/event shapes and generated types are unchanged. The
private disposal action is additive within v1; old compositions refuse without fallback.

Apply migration 0009 before updated private control/disposal code and any separately reviewed
activation. Old writers still produce NULL and remain ineligible. Code rollback retains the
column, trigger, inventory and positive-disposal deletion constraints. Existing candidate-owned
cascade deletion covers the metadata; retention duration and public policy are unchanged.
The source restore/image inventories add exactly one migration: seven owners, eleven schemas,
84 relations, 59 checksum-bound migrations. Historical inventories stay valid only against their
own exact source. New operator evidence cannot reuse a prior 58-migration receipt.

## Verification checkpoint

- 174 focused cleanup/RPC/bootstrap/store cases pass.
- All 1,106 Documents unit cases pass; Documents typecheck and dependency build pass.
- All 308 real PostgreSQL cases across seven Documents files pass on owned tmpfs PostgreSQL
  16.14. Added cases cover native actor/RPC failure proof, active/generic-fenced/old/successful/
  quarantined/non-dispatched refusal, terminal reasons, immutable/conflicting replay, exact
  ownership, unknown identity, native failure eligibility/bootstrap and lost read ACK.
- Existing rejection/non-dispatch fault tests now inject an actual PostgreSQL update failure,
  proving atomic rollback and safe successful retry. Positive disposal retains another running
  private writer and verifies artifact deletion remains refused.
- All 42 restore unit cases and 153 production migration-runtime smoke cases pass.
- Initial SQL run exposed fixture issues (missing native bootstrap session token, old ledger
  state expectations and obsolete method-level settlement fault injection). Fixed fixtures and
  real SQL fault injection; no product guard was weakened. Initial type inference/mock-order
  assertions were corrected; terminal reruns pass.

Provider/Lambda/secret/object transports and authentication are simulated; SQL is real. No live
provider call, S3/KMS enforcement, managed authentication or deployed end-to-end test is claimed.
The 59-migration whole-boundary PostgreSQL 16.6 restore/replay passes: 84 exact relation row
sets, 18 populated required D2 relations, five restored response rows, five reservation replay
refusals, three unresolved-inventory deletion refusals and both read-only write refusals.
Both classified failure rows retain owned eligibility after restore and reject proof clearing
and conflicting original settlement. The initial strengthened fixture used a snake-case
property against the harness's camel-case SQL client; an explicit alias corrected the fixture,
then the full restore rerun passed. No production mutation or guard weakening.

The maintained full verifier initially stops at its committed-source migration contract check
because HEAD predates the uncommitted migration; the source checkpoint must be committed before
rerunning. The first local image attempt passes package smoke but refuses the omitted required
SOURCE_DATE_EPOCH. Rerun uses the required source timestamp; local image/full verifier are pending.
No user-facing change requires browser acceptance. Runtime/IAM, maintained scheduling, ambiguous
abandonment/writer drain, retention and accountable/deployed acceptance remain open.


## Additional local checkpoint

Source commit `60bc469` contains the original eligibility/migration work. Full verification
then exposed the retained old manifest SHA in the TypeScript/PowerShell deletion-restore
validators and one old expected migration count in the restore guard test. Synchronize the
exact new SHA, recompute only generated-synthetic fixture configuration/inspection digests,
and retain strict historical-boundary refusal. This is required migration rollout work, not
an acceptance waiver. All 1,412 workflow unit cases now pass (20 existing integration cases
remain skipped); both restore/operator guard hosts pass, with cross-runtime replay rerun pending.

The local migration image builds with the required deterministic SOURCE_DATE_EPOCH, passes
package smoke and actual production-runtime smoke in a network-disabled non-root container.
This local diagnostic image is not a released source-bound image/receipt or AWS evidence.
The strengthened 59-migration restore replay passes with both immutable failure rows retained.
Both owned PostgreSQL fixtures were removed, recovery cleanup passed, Docker Desktop stopped
and WSL shut down. Shared volumes remain intact.

Four private control artifact sets and one isolated actor set build from exact clean `60bc469`.
All twenty archive/bundle/manifest/SBOM objects pass independent integrity checks, and actual
bundled read_failed/settle_terminal default-off/closed-input refusals attempt zero fetch calls.
The initial unconstrained build correctly reports sourceSha=local; rebuild with explicit clean
ARTIFACT_SOURCE_SHA yields verified committed provenance. Nothing is published or activated.
Full exact-source verification/rebuilt final artifacts are still pending after restore identity correction.


## Final local verification (2026-10-04)

Exact clean source `e071d9e` passes `scripts/verify-phase0.ps1`: 38 typecheck tasks, 39 test tasks,
23 builds, public contract generation, formatting, operational/security guards, Compose, product
scope and compiled isolated-provider dependency checks. Lint remains 0 errors, 15 warnings and
58 informational notes. This final result supersedes earlier pending/failure checkpoints above.

The final verifier includes all 1,106 Documents units, 1,412 workflow units (20 existing external
integration cases skipped) and 42 restore units. Separately, all 308 Documents real PostgreSQL
cases passed on source `60bc469`; the later change synchronizes restore manifest identity and
synthetic fixtures without changing Documents implementation/migration bytes. The strengthened
59-migration restore replay preserves both classified failure proofs and all 84 exact relation
row sets, with fixture cleanup succeeding. Provider/Lambda/secret/object/auth responses remain
simulated. The actual local diagnostic migration image and its network-disabled production
runtime smoke pass; nothing is published to a registry or deployed.

Migration image publisher and restore verifier guards pass on PowerShell 7.5.4 and 5.1; D2
inventory guards pass 252 assertions on both hosts. The candidate deletion replay suite explicitly
requires PowerShell 7.4 or newer: all 697 generated boundary checks pass on the supported host,
including the final verifier. An attempted PS5 launch correctly refuses that version requirement;
no PS5 replay pass is claimed. The initial direct-call wrapper mistook a residual native negative
check exit code for suite failure after the successful summary; the supported full verifier
provides the terminal pass. No runtime/version guard was weakened.

Five artifact sets rebuild from exact clean `e071d9e`: four private control and one isolated actor,
twenty archive/bundle/manifest/CycloneDX SBOM objects. Independent archive contents/bytes, hashes,
source SHA and SBOM integrity all pass. Actual bundled read_failed and settle_terminal default-off
and extra-field refusal checks make zero fetch calls. These artifacts are local and unpublished.

All five newly added relative Markdown targets resolve. Complete original tracker/phase nonblank
lines from dependency `10f196b` remain in order. One pre-existing historical tracker link to the
removed frontend foundation-form file remains outside this backend change. Docker Desktop/WSL
are stopped and no owned SQL fixture remains; shared volumes are retained.

Review/merge, the migration-before-code rollout, current-source restore helper/operator release,
reviewed IAM, maintenance scheduling, ambiguous abandonment/other-writer drain, retention and
accountable/deployed acceptance remain. No D1/D3 exit criterion is marked complete from this slice.
Hosted CI/CD remains deferred until production launch; no production gate is waived.
