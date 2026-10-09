# D3-087: Observed form and saved-answer selection

Date: 2026-10-09. Default-off source; locally verified batch. D3 remains In progress.
Independent D1 acceptance, including hosted admin acceptance, stays deferred.

## Implemented source

Explicit extension question capture -> protected owner/application/job and tab/account checks ->
bounded top-frame structure -> candidate clipboard -> exact web application -> current job source
and saved metadata reads -> exact version/context selection and meaning confirmation -> existing
protected packet preparation -> mandatory final review -> fresh matching form confirmation -> manual Apply -> candidate-confirmed history.

Captured structures exclude entered values, uploads, hidden/password/action controls and control
contents inside labels. Unknown/value-bearing metadata, challenges, oversized structures, wrong
application/job/destination, future/stale captures and changed tab/account/revision are refused.
No persistent snapshot queue or new host permission is added. Original capture lease is 60 seconds.
Clipboard copies remain candidate controlled; hidden/exit, clear, unmount and expiry discard memory.

Only unambiguous supported restricted fields offer saved metadata; choices default empty and each
version/context change resets confirmation. US work authorization requires explicit United States
wording; generic wording cannot infer jurisdiction. Raw question text and vault values are absent
from preparation requests. Existing exact-version correction/deletion/expiry guards stay authoritative.
Later edits preserve user-entered answers/form/unchanged vault references; explicit field edits
replace that field's reference. Final review shows saved version/context and Yes/No truthfully,
does not call vault references confirmed facts, and blocks approval at original saved-answer expiry.

Backend inspection found that manual start deliberately supplied a null form hash and invalidated
form-bound approval. The new optional closed v1 `observedForm` command preserves that legacy
invalidation while permitting a fresh candidate-attested match: original capture time, exact binding
and explicit confirmation. Web checks the imported structure hash/current destination; SQL checks
the original 60-second lease after application/vault locks. A fresh changed hash still invalidates
approval. Identical accepted requests replay after expiry; a changed proof cannot replace the
original action key. Lost responses trigger an owner-scoped refresh. No provider dispatch occurs.
Deploy compatible Gateway/Applications readers before enabling these client commands; old strict
servers reject the additive property. No schema migration, new endpoint or content persistence.

Web selection and extension handoff/capture remain off by default. Backend reuse remains separately
gated. No provider adapter or live capability is activated. See [ADR-046](../../../adr/046-observed-form-saved-answer-selection.md).

## Verification

Targeted SDK (32), extension handoff (53), contract (115), web selection/review/reader/workspace
(133 before the manual extension) and manual-form/Apply/workspace (56) regressions pass. The full package pass includes 891 web, 536 extension, 115 contract, 32 SDK and 379 Gateway tests;
128 opt-in Gateway integration skips are not managed acceptance.

Real local PostgreSQL selected-vault composition: all 40 cases pass, including selected false value,
final sensitive acknowledgement, fresh manual start, expired-proof replay of one accepted attempt,
candidate confirmation/history, absent/changed/stale/future/wrong-adapter/variant/unconfirmed proof,
lease expiry while waiting for a transaction lock, and correction/deletion/expiry refusal. Existing
Applications service/store suites also pass all 55 cases sequentially, including disposable dispatch
rollback coverage. The store suite's stale 0011 migration expectation now correctly names 0015.
The first test setup refused the retained legacy database; it was preserved and testing used two
separate disposable databases. Running fresh-schema owners in parallel exposed PostgreSQL's schema
creation race; sequential owner execution passes without changing migrations. OIDC/ciphers/bindings
in these integration fixtures are synthetic; PostgreSQL transactions/migrations are real.
The synthetic real-Chromium capture/clipboard/selection/review/approval/fresh-form/manual-confirmation/history
journey passes. Identity, Chrome APIs and service responses are simulated; extraction, readers,
validators, UI, clipboard, canonical hashes and review behavior use production source.
The browser test found a label containing option text; explicit label/control association fixes it.
No installed/live identity/provider or managed-persistence acceptance is claimed.

The unchanged search/prepare/review/approve/manual-confirmation/history, native preview/disconnect/
four approved downloads, idle expiry, keyboard and automated WCAG Chromium journey also passes.
All 41 maintained `scripts/verify-phase0.ps1` verification steps are satisfied across the initial
run and exact resumed portions: generation/operational guards, formatting/lint (existing 15 warnings),
39 typecheck/dependency tasks, dependency-security regressions, 23 builds, 40 package test tasks,
all bundle-isolation checks and Compose configuration. The initial run stopped on a final help-text
edit's line endings; formatting was repaired and the unchanged script resumed from Formatting.
That run found a stale Turbo dependency expectation and a test checking before WebCrypto completed;
the dependency list and asynchronous completion wait were corrected, web typechecking and both
focused suites passed, and the unchanged script resumed from Tests through its final success.
This is complete gate coverage, not a claim that the first uninterrupted invocation passed.
Contract regeneration is byte-identical; diff/format and all checked local Markdown targets pass.

Shutdown: no AWS runtime was activated. Fresh staging status at 2026-10-09T21:26Z verifies dormant:
no database, managed interface endpoints, public runtime routes, enabled event mappings/rules or
queued messages. Development was last independently verified dormant at 18:40Z; its separate SSO
session is unavailable while staging is signed in, per the owner's sequential-access constraint.
No development mutation occurred. PostgreSQL was stopped after integration tests, Docker Desktop
stopped and WSL reports no running distributions. The PC stays on. Retained recovery snapshots,
object/image/log storage, monitoring, keys, secrets and DNS can incur charges.

## Remaining gates

D3-088 remains source work: the existing full Application projection intentionally refuses stale
selected values (the SQL negative suite asserts this). A safe owner-scoped recovery path must let
the candidate reopen/reprepare or reconcile without revealing withheld answers. This batch proves
refusal and the positive journey, not recovery after withdrawal. Preserve the current value-read
refusal rather than echoing an old value or silently rendering it as a current null answer.

Installed Chrome/Edge and live same-owner/backend reuse/native/provider/release acceptance,
authorized representative Greenhouse fixtures and independent QA, all-copy generated-material
expiry, rights/restore and accountable legal/security/privacy/product reviews remain open.
Retained AWS recovery/storage/security resources can incur charges; no zero-cost claim is made.
