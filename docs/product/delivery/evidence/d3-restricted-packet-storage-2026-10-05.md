# D3-077 restricted packet storage — started 2026-10-05

Status: In progress. Backend-only private WIP on isolated branch
`feat/d3-restricted-packet-storage`, started from `2b6f59aa` and now rebased onto merged #559/main
`18b6b2e2`. Local WIP checkpoints are not published or review-ready.
Hosted CI/CD remains deferred until production launch. No feature is activated or deployed.

## Confirmed gap and required end state

Applications `store.ts` writes `packet.fields` directly as ordinary JSON. `createPacket` and
preparation receipt preflight/queue also hash request bodies containing supplied answer values.
`packet.ts` hashes clear field values. Encrypting values alone would leave public/stored packet
and request hashes vulnerable to enumerating low-entropy answers. D3-076 must remain disabled.
ADR-010 and architecture 12.3 require separate restricted storage/keys and just-in-time access.

The intended complete path is candidate request → owning Applications policy/protection →
metadata-only packet and immutable encrypted value record → metadata approval/dispatch →
authorized immediate owner/adapter value read. Generated document material remains forbidden in
all durable value records, including encrypted ones (ADR-038). No inferred/hidden sensitive answer
or new public user flow is authorized by this work.

Completion must prove:

1. Restricted and selected vault values never enter ordinary packet/receipt/outbox/history JSON.
2. Value-free packet metadata binds randomized authenticated ciphertext; request replay uses a
   keyed fingerprint, with no persisted plaintext digest that enables answer enumeration.
3. Owner/application/original value identity and question/provenance/policy metadata are bound;
   malformed/moved/tampered envelopes and missing key/protection capabilities refuse.
4. KMS encryption/fingerprinting occurs before SQL locks, owner reads decrypt after releasing
   locks and revalidate ownership/current snapshot after the await. Approval and dispatch need no
   value decryption and preserve mandatory review, correction/expiry and duplicate safety.
5. Preparation retains exact protected values through original completion without decrypting
   inside transactions or renewing selected vault references. No plaintext fallback is accepted.
6. Authorized candidate export returns the exact chosen historical values through a narrow
   reader; deletion removes encrypted records only with existing privacy authority and writer
   checks. Real SQL, logical restore and migration/rollback compatibility must be tested.
7. Full maintained verification and private artifact isolation pass on clean committed source;
   release/IAM/key/retention/accountable and client/ATS gates remain distinct.

## Implemented prototype and focused evidence

Applications now declares a private type-only cipher port. A separate, uncomposed Gateway factory
implements envelope encryption (fresh AES-256 data key, AES-GCM/96-bit random IV/128-bit tag),
owner/application/protection-ID/value-free metadata context and a distinct KMS HMAC-SHA-256
request authority. Candidate value bytes are encrypted locally; KMS requests carry only data-key
context or an ephemeral request digest, never the candidate value body. Keys and MAC authority
are pinned to distinct exact ARNs in the same region/account. No alias/foreign key or configured
endpoint override is allowed. Both encryption and decryption clear controlled returned key bytes;
decryption withholds partial/late/refused plaintext. This is best-effort controlled-buffer cleanup,
not a claim of physical all-copy memory erasure.

The factory defaults off, is uncomposed, has one admitted original SDK promise and no retry.
Timeout/abort does not release admission while the original promise remains pending. Endpoint,
region, normal-client configuration and actually signed installed SDK serialization are exercised
with offline transports. Test client injection is restricted to NODE_ENV=test.

Thirty focused tests pass: randomized exact-byte round trip, moved context, tampering, strict
getter/hidden/symbol/size refusal, key-response validation/cleanup, keyed request identity,
late SDK timeout/admission, flag/environment changes, actual default client configuration and
signed offline SDK success/failure with one attempt. Applications build and Gateway typecheck
pass after the prototype; scoped lint has zero diagnostics. Logs are ignored under
`.tmp/d3-restricted-packet-cipher-unit.log` and `.tmp/d3-restricted-packet-typecheck.log`.
No SQL, migration, export integration, complete repository verifier, browser or live KMS evidence
is claimed yet. Docker/WSL were not started. Existing packet persistence remains unchanged until
the full storage wiring lands; this prototype does not close D3-077 or enable saved-answer reuse.

## Owning metadata codec — source-only checkpoint

The private Applications codec now masks restricted and selected vault values with null plus a
private protected marker. It returns immediate decoded values in a separate map rather than
hydrating a metadata-only packet used for approval. Its value-free commitment binds exact
owner/application/protection identity, job/form, provenance, selected vault revision/context and
field policy. Ciphertext identity covers every randomized envelope component. Definition
configuration and command context are captured before awaits.

The codec rejects extra, hidden, symbol and accessor properties before cloning; validates exact
field, form, provenance, confidence and envelope shapes; and refuses document material even when
misclassified as restricted. Reads require exact canonical JSON, preventing duplicate keys or
noncanonical representations from being silently normalized. Malformed UTF-8, mismatched value
types/field sets, changed metadata/policy and disabling during a decrypt await all withhold values.
Controlled encoded/decrypted byte buffers are cleared on success and refusal; immutable strings
and engine copies cannot be physically erased by this mechanism.

Local checkpoint: all 268 Applications unit tests across 18 files pass, including the new codec
cases using real offline AES-GCM; Applications typecheck passes. All 30 Gateway cipher tests also
pass again. Biome checks on all six changed TypeScript files have zero diagnostics. Logs are
`.tmp/d3-restricted-packet-applications-unit.log`, `.tmp/d3-restricted-packet-codec-typecheck.log`
and `.tmp/d3-restricted-packet-cipher-unit.log`. These are source unit checks on the uncommitted
isolated branch, with synthetic inputs and offline crypto/provider transports. No database,
production build, complete verifier, live KMS, deployment or UI evidence is claimed. The codec
is private and uncomposed; existing packet persistence has not changed.

## Packet commitment and immediate public projection — source-only checkpoint

Private packet metadata now supports an exact immutable restricted snapshot identity and a
protected marker. `application-packet.v2` binds those identities and the masked field metadata.
The old published v1 hash remains byte-for-byte unchanged when protection is absent, verified
against the compiled original fixture. Hash verification and approval refuse plaintext in a
protected field, missing/extra/malformed binding, auto/unreviewed/direct-action markers and
protected document fields. Opaque protected fields still require explicit acknowledgement;
empty direct candidate actions remain unresolved.

The owning codec has a synchronous bind step with no cipher calls. Ephemeral WeakMap proofs
admit only the exact prepared result for the exact classified fields, including answer values,
and original context. These comparison digests are never serializable/persisted/public. Changed,
moved or cloned results and changed candidate inputs refuse. Bound metadata is detached/frozen;
later mutation of the prepared record cannot alter a bound packet.

Public projection accepts a separate exact owner/application/packet/hash value map and emits the
existing strict API shape with chosen values, omitting internal storage markers and bindings.
Missing/foreign/incomplete/unsafe read results fail unavailable rather than silently displaying
null. The owning asynchronous authorized reader remains unwired; this mapper supplies no access
authority or active-candidate lease.

All 304 Applications unit tests across 19 files pass after these changes. Applications typecheck
and production TypeScript build pass, Gateway typecheck passes against that build, and ten-file
Biome checks have zero diagnostics. These are local uncommitted source checks with synthetic
inputs; SQL, complete verifier, UI/browser, live KMS and deployed acceptance remain absent.
Logs: `.tmp/d3-restricted-packet-applications-unit.log`,
`.tmp/d3-restricted-packet-codec-typecheck.log`, `.tmp/d3-restricted-packet-applications-build.log`,
`.tmp/d3-restricted-packet-typecheck.log`. [ADR-041](../../../adr/041-restricted-packet-values-and-keyed-replay.md)
records the proposed full storage/replay boundary, explicitly distinct from accepted product
policy and from still-unfinished persistence/key/rotation/export/deletion/restore wiring.

## First real PostgreSQL write boundary — unfinished slice

Applications source now requires enabled restricted protection and exact MAC authority for packet
creation and preparation request replay/queue. Owner/active-candidate reads complete before KMS;
request digests exist only as ephemeral MAC inputs. Original receipt algorithm/key authority is
stored and checked; unsupported historical authority refuses without a new MAC or fallback.
An existing exact receipt replays without another envelope encryption. Packet fields are classified
and encrypted before the write transaction, then exact owning binding and ciphertext/metadata/
receipt/history/outbox writes occur atomically. The owning configuration is uncomposed/default-off;
old callers without it now fail unavailable for these commands. Service composition/error mapping,
authorized reads and fixtures require updates before review.

Forward migration `0009_restricted_packet_values` adds a separate `applications_restricted` schema,
immutable encrypted snapshots, exact owner/application/digest packet foreign references, mandatory
masked restricted fields, keyed packet/preparation receipt authority, an active-candidate insert
lease and privacy-authorized snapshot deletion after packets. It refuses legacy restricted
plaintext/unmodelled packet fields and existing unkeyed packet/preparation receipts before changing
them. This is an explicit incompatible legacy-data transition gate, not a backfill or permission
to purge historical evidence. The latest existing preparation deletion order/privacy checks are
retained. Structural registration verifies the extra relation, guards, validated constraints and
restricted deletion body. Export enrichment, role grants/owner inventory, full migration/restore
boundary expectations and full integration fixture compatibility remain unfinished.

Eight real PostgreSQL 16.6 tests pass in an owned tmpfs fixture: first migration and exact replay,
masked ciphertext/metadata/keyed receipt/event commit and exact replay without encryption,
ordinary v1 metadata with a keyed request receipt, direct restricted plaintext refusal, concurrent
identity/application `FOR UPDATE NOWAIT` during encryption, rollback of ciphertext and packet on
metadata insertion failure, concurrent duplicate retention of one record, stale revision refusal
and unsupported historical MAC authority refusal without issuing a new MAC. The suite uses
synthetic candidates and an offline AES-GCM/HMAC port; wrapped-key/provider behavior is simulated.
This does not prove production KMS/IAM, live reads, submission, export/deletion or restore.

Applications typecheck/build pass; 307 local unit tests include three unavailable-configuration
cases proving no SQL/crypto effects. Logs: `.tmp/d3-restricted-packet-sql.log`,
`.tmp/d3-restricted-packet-store-typecheck.log`, `.tmp/d3-restricted-packet-applications-build.log`,
`.tmp/d3-restricted-packet-applications-unit.log`. The owned fixture
`2dd730bdf180db2d12765354b2a8c1dc2f26908ccf926c01a076db23d87ded10` was identity/label/tmpfs-validated
and removed; shared Docker volume inventory stayed identical. Docker Desktop stopped successfully
and WSL reports no running distributions. PR #559 merged as main `18b6b2e2`; main's complete tree
matches its verified head. This SQL checkpoint used the isolated restricted branch before ancestry
reconciliation; it is not evidence for the combined full restore boundary.

## Ancestry reconciliation

Local WIP `d084d74a` was rebased onto exact-tree merged #559/main `18b6b2e2`, producing
`50a6c8ce`. Only the two appended delivery-log conflicts needed resolution; both histories were
preserved. Git confirms the SQL-tested migration/store/driver/integration/packet/codec source is
unchanged through rebase. The combined branch now includes the reviewed native registry boundary,
so whole-boundary restore counts/inventory must include both additions. No authored PR is open;
this incomplete restricted slice has not been pushed or submitted for review. Full clean verifier
remains a requirement after the complete feature and compatible maintained fixtures are ready.

## Candidate-review reads and original preparation carry-forward

The owning read accepts an exact owner/application/packet/hash/revision. It admits the active
candidate and exact current packet/vault references in a short transaction, reads the original
immutable envelope and records identifier-only audit admission, commits, then decrypts. A fresh
transaction independently rechecks active ownership, revision/current packet, exact snapshot and
current vault versions/expiry before audit validation. Controlled returned maps are cleared on
refusal. This is point-in-time authorization, not a client response lease. Admission/validation
stages do not claim the caller displayed or submitted a value.

The same unshipped 0009 migration now includes a second private relation, `packet_read_audit`,
with exact owner/application/packet FK, append-only/active-candidate/privacy deletion guards and
closed purpose/stage labels. Its entries contain identifiers, fixed labels and timestamps only;
no answers, request/MAC hashes, encryption keys or provider/error bodies. Deletion removes audits
before packets and ciphertext after packets. New structural verification checks both relations and
six owning triggers; the combined future full boundary requires both private relations in inventory.
This migration remains unshipped WIP, so its changing checksum is not a production migration edit.

Service responses use the optional exact owning reader when protected fields exist; search reads
are sequential to respect bounded crypto admission. Projections retain existing strict public API
shapes, clear controlled source maps after copying immediate values and fail unavailable for absent
or mismatched reads. Gateway exposes an optional private protection configuration (absent by
default), wires the owning reader and maps store protection failures to stable value-free 503
problems. No keys/IAM/configuration/feature activation is supplied by this optional composition.

Preparation completion omits masked proposals from reclassification and synchronously restores
only the exact admitted original base fields/reference. It preserves review/provenance/policy and
ciphertext identity, performs no decrypt/re-encrypt, and refuses moved context, overlapping/new
restricted values, non-advancing versions or modified original metadata. Current base identity is
independently checked under the actual owning transaction; no renewed vault authority is inferred.

All 14 PostgreSQL 16.6 cases pass with synthetic candidates and offline crypto. Six added cases
exercise exact separate values/audit/strict owner API, identity/application lock availability during
decryption, cancellation/quarantine races, foreign owner refusal before decrypt and exact protected
preparation completion with one encrypted record and no cipher calls during completion. These
checks do not prove Profile-backed correction/expiry races, historical export, deletion/restore,
actual managed OIDC/KMS/provider, client final review or production deployment.

All 314 Applications unit tests pass, including seven new carry invariants and unavailable-reader
no-effect checks. Applications typecheck/build and Gateway typecheck pass; the focused HTTP problem
mapping case passes (one selected, 99 unrelated skips), using test authentication/fake API failures.
Logs: `.tmp/d3-restricted-packet-read-sql.log`, `.tmp/d3-restricted-packet-read-typecheck.log`,
`.tmp/d3-restricted-packet-applications-unit.log`, `.tmp/d3-restricted-packet-applications-build.log`,
`.tmp/d3-restricted-packet-typecheck.log`, `.tmp/d3-restricted-packet-http.log`.
The owned tmpfs fixture `eee854cf32bf6903eb68ae963887b1b5dd8d79b811fbc3f8b8598416e59fb5fb` was
identity/label/tmpfs-validated and removed. Shared Docker volumes stayed identical; Docker Desktop
stopped and WSL reports no running distributions. No UI/browser or complete-verifier claim is made.

## Historical export authorization and privacy deletion checkpoint

The private Applications export reader now admits the exact owner/export request/running
operation/policy through a Profile-owned transaction callback before and after decryption.
Request and operation locks are released before crypto awaits. Historical reads bind each original
packet/hash/envelope rather than the current packet or latest saved-answer value. Candidate-review
reads retain their stricter current-revision and current-vault requirements. Identifier-only audit
entries distinguish export purpose and exact request/operation IDs; no answers or key material enter
audit. Missing authorizer/protection fails unavailable without SQL or crypto effects.

Unshipped migration 0009 strips the internal protected-field marker from public owner exports and
returns a separate private inventory containing exact application/packet/hash/field-key references.
Workflow assembly checks the strict metadata envelope, enriches only exact declared fields through
the narrow reader, clears controlled returned maps, then validates the strict portable envelope
again. The private inventory, bindings, envelope and keys never enter the portable artifact. Reader
composition remains optional and absent by default; a nonempty private inventory without its reader
refuses artifact creation. Applications uses Profile only as a workspace dev dependency for the
actual authorization integration; production ownership remains through the structural private port.

All 19 real PostgreSQL 16.6 cases pass with synthetic identities and offline envelope/MAC crypto.
Five added cases prove distinct original true/false values across two historical packets; missing
and foreign rights-request refusal before decryption; request/operation lock availability during
decryption and refusal after request failure; unauthorized direct deletion refusal; and exact
privacy-authorized removal of audit/packet/ciphertext while retaining another candidate's records.
These are local persistence and authorization checks, not live OIDC/KMS/AWS or whole logical restore.
Log: `.tmp/d3-restricted-packet-export-sql.log` (2026-10-05, 18:49:58 local).

Applications' 314 unit tests pass after the shared reader refactor. Seven Profile-owned export
admission cases and 46 focused Workflow helper/owner-composition cases pass. Four new actual
activity-assembly cases validate the stored strict artifact, unchanged source metadata and cleared
returned map, and prove no artifact is written for missing readers, malformed private references or
foreign reader scope. The existing unavailable-protection cases now also cover historical export.
Applications, Profile and Workflows typechecks/builds pass; scoped Biome checks pass on all 13
changed TypeScript/JSON files. Reader result accessors are refused without invoking them during
cleanup; Maps with overridden methods are refused and controlled Maps are cleared through the
native method. These two additional adversarial cases pass with the focused suite. The complete
Workflow unit suite passes: 1,613 tests passed, 57 skipped (42 files passed, nine skipped).
Logs: `.tmp/d3-restricted-packet-export-applications-unit.log`,
`.tmp/d3-restricted-packet-export-workflows-unit.log`.
No frontend/public contract, production configuration, feature activation or deployment changes.

The owned tmpfs PostgreSQL fixture
`0ca525bc10a18805b8af445f08f6c678a70590148ee5f4d0c96e448d8cc81bd0` was checked against
its exact identity, name, label and tmpfs before removal. Shared volume inventories stayed identical.
Docker Desktop was stopped and WSL reported no running distributions. No actual restore or full
maintained-verifier claim is made for this incomplete private checkpoint.

## Profile-backed selected-answer reads and expanded restore inventory

Eight additional real PostgreSQL cases pass through the actual Profile owning vault store and its
same-transaction metadata admission callback. Current review returns the original protected value
without decrypting the saved vault again. Same-value correction and deletion during packet decrypt
withhold the result; the tests acquire the exact Profile writer advisory lock and answer row lock
while decrypt is pending, proving neither is retained across crypto. Already-expired selections
refuse before packet decryption; expiry during decrypt withholds the value and retains only audit
admission, not a validated read. Authorized historical export still returns the original packet
value after the saved source is corrected to the opposite value, deleted or expired. Source
metadata stays masked and mandatory review remains true. Profile vault crypto is simulated through
opaque in-process handles; packet envelope/MAC crypto is offline. No live KMS/provider/OIDC claim.

The expanded owned suite passes all 27 cases on PostgreSQL 16.6. Applications build passes, including
TypeScript compilation of the new integration cases. Log:
`.tmp/d3-restricted-packet-selected-sql.log` (2026-10-05, 19:01:14 local). The owned tmpfs fixture
`b489251110eb85bc054c7e7bc522c464aa36b325770fea003b0f08279bb0c707` was verified against its
exact ID/name/label/tmpfs and removed. Shared Docker volumes remain identical; Docker Desktop
stopped and WSL reports no running distributions.

The authoritative restore manifest adds `applications_restricted`, both private relations and the
exact LF-normalized unshipped 0009 checksum. Current structural boundary is 65 migrations,
88 relations and 12 owned schemas across seven owners. Its exact file SHA-256 is
`0679090d17a5aedb76f7c44ebd9ea6b536a349b51ce34140c48154b147cac93e`.
The Workflow/PowerShell private replay constants and generated configuration/inspection digests
are synchronized. All 48 migration/restore unit cases pass, including a new exact historical
64-migration/86-relation native boundary that cannot verify restricted storage. Existing historical
42/47/52/57/58–63 fixtures retain their original schemas, relations and migration counts.

The current staging restore/operator and migration runtime package inventory checks are updated
for the expanded boundary. PowerShell manifest ordering now uses ordinal comparison for schemas
and qualified relations, matching TypeScript lexical order when the underscore schema is present.
No duplicate/unknown relation tolerance is added. Offline staging restore guard tests pass;
697 generated deletion replay operator checks and 231 Workflow contract/policy cases pass with
zero cloud calls. The exact migration runtime smoke passes all 165 offline checks, including
every missing/tampered SQL migration; migration image publisher OCI guards pass. Migration
orchestrator typecheck/build and Workflow build pass. Maintained
logical recovery harness counts are updated, but it has not yet run against this boundary;
actual restore, restricted-record behavior after restore and isolated SQL role grants remain
outstanding. No migration image was built, published or deployed by this checkpoint.
Logs: `.tmp/d3-restricted-packet-restore-operator.log`,
`.tmp/d3-restricted-packet-replay-operator.log`,
`.tmp/d3-restricted-packet-migration-publisher.log`.

## Actual logical restore, private SQL refusal and deletion replay

The maintained `pnpm test:d2-recovery` harness now supplies offline keyed request authority to its
existing temporary-packet fixture and seeds three immutable restricted snapshots across two
synthetic candidates, with distinct true/false historical values, original keyed command receipts
and actual admitted/validated read-audit entries. Source migration fresh/replay passes all seven
owners. PostgreSQL 16.6 custom-format `pg_dump` and `pg_restore` run inside owned tmpfs; aggregate
verification and exact sorted full-row equality match all 88 relations across the two databases.
The current 65-migration/12-schema boundary passes and the source remains unchanged after restored
behavior tests. Existing D2, provider-lease, response-ledger and temporary-material regressions pass.

Restored restricted checks return all three original chosen values through the actual authorized
Applications historical reader. Three original command receipts replay with their pinned HMAC
scheme/key authority without new encryption. The public owner export keeps values masked until the
private read and strips internal field markers. A generated NOLOGIN metadata role can select masked
ordinary packet fields but is denied both private tables before and after restore (four refusals).
No production role grant is introduced. Source and target share cluster roles, so this is a table/
schema permission refusal check, not cluster-role recovery or a production least-privilege signoff.

Direct unauthorized ciphertext deletion refuses. The exact privacy-authorized Applications port
removes the selected candidate's ciphertext/read audit while preserving the other candidate's
records and metadata. The pure owning cipher is simulated offline with test-only process keys;
there is no KMS call, real candidate value, live provider, cloud identity, persisted host dump,
cluster-role restore, AWS PITR or RTO/RPO evidence. The harness clears controlled test keys and
removes its identity-validated owned container before emitting passing aggregate metrics. Fifteen
container-ownership guard cases pass. Log: `.tmp/d3-restricted-packet-logical-restore.log`.

The actual deletion verifier's Applications count now includes both private relations. Its real
PostgreSQL integration fixture seeds protected snapshots and read audit for every generated
candidate. All six existing integration cases pass, including seven/eight-owner historical policy
replay, idempotent cleanup, preservation of another candidate, collision refusal and a real strict
portable export through Profile request/operation authorization and the Applications reader.
A focused final rerun verifies the artifact includes exactly the chosen value and no private
inventory or protected-field marker (one selected case passed, five unrelated skips). The fixture
uses an independent Applications pool to preserve its owning SQL column/JSON mapping. Workflow
build and 27 deletion-store unit cases pass. Logs:
`.tmp/d3-restricted-packet-deletion-replay-sql.log`,
`.tmp/d3-restricted-packet-export-pipeline-sql.log`.

The separately owned replay fixture
`4f16e3af627b1bda4a146a2848ec14715146020cf5a39c41da115e8d46036f49` was verified against its
exact ID/name/label/tmpfs and removed. Shared volume inventories stayed identical. Docker Desktop
stopped and WSL reported no running distributions. Scoped Biome retains six pre-existing
informational template suggestions in the touched replay integration test; no unsafe fixes applied.
This remains a private local WIP checkpoint, without full maintained-verifier or deployment claims.

## Maintained Applications SQL fixture compatibility

The eight maintained Applications integration modules now supply explicit offline packet protection
and seed active synthetic identities before invoking the original store/service commands. A private
integration-only adapter shares one process cipher authority per module so clock-shifted stores
retain exact request replay and decryption semantics. The real Applications service receives the
owning private read port; no SQL/provider/response is mocked and no production default is changed.
The adapter refuses factory use outside test mode, is absent from the service root exports, and
clears controlled process test keys in test teardown. Artifact isolation remains an outstanding
whole-slice requirement rather than an assumption about this support file.

All 92 maintained PostgreSQL cases pass across eight files, including hardening, rights, preparation,
service projection, lifecycle acceptance, measurement and submission dispatch. The 27 separately
owned restricted-storage cases are skipped under this fixture's strict
`application_dispatch_protection` database identity; their prior separate 27-case evidence is
unchanged. All 314 Applications unit cases and the package build pass. Scoped Biome has no
remaining new warnings or errors. Tests use synthetic identities and offline AES/HMAC authority,
not live sign-in/KMS/provider/ATS. Logs:
`.tmp/d3-restricted-maintained-applications-sql.log` (2026-10-05, 19:23:38 local),
`.tmp/d3-restricted-maintained-applications-unit.log`, `.tmp/d3-restricted-fixture-biome.log`.

The historical pre-0007 document migration refusal fixture removes the later restricted-fields
constraint only inside its deliberately rolled-back synthetic transaction, preserving the original
legacy-data refusal target. It now also asserts both production constraints remain validated after
rollback. Current valid direct-SQL packet fixtures use the complete required closed metadata shape;
no production guard is relaxed. Duplicate candidate setup retains existing active identities, and
the manual-service fixture now seeds its candidate explicitly before packet protection admission.

Owned PostgreSQL tmpfs fixture
`2f93a3cace706266f3359bc826b0059edd7260b4afaefb1c30b71cbf36bd33f3` was verified against its
exact ID/name/label/tmpfs and removed. Shared volumes remain identical. Docker Desktop stopped and
WSL reports no running distributions. No frontend, public contract, production activation or deployed
verification claim. Gateway/Workflow maintained protection fixtures, legacy transition and complete
clean verification remain unfinished; this checkpoint is private WIP.

## Maintained Gateway SQL fixture compatibility

Three maintained Gateway integration modules now explicitly compose offline packet protection.
All store/runtime instances within each module share the same test authority, preserving original
keyed replay and packet decryption. Database/temporary-material fixtures seed active synthetic
candidate identities; the vault fixture retains its real Profile-owned identity and metadata ports.
The production composition/default-off switches and public contracts remain unchanged.

All 56 targeted PostgreSQL cases pass: the database and temporary-material modules passed in the
initial three-module run (33 cases); the affected vault module passed its final focused rerun
(23 cases). Initial stale-value projection expectations failed and were corrected to assert the
owning candidate reader's availability refusal after correction/deletion/expiry. The tests separately
inspect the actual metadata store to prove immutable original version, masked value, committed
approval invalidation, failed-no-effect attempts and absence of dispatch. A removed admission port
still permits a valid candidate read through its independently configured original owning reader.
No production read guard is relaxed to accommodate fixtures.

The Gateway package build and all 348 unit cases pass; 85 integration cases are skipped without
DATABASE_URL in the unit run. Scoped Biome and git diff whitespace checks pass. Logs:
`.tmp/d3-restricted-gateway-sql.log` (initial run, with superseded vault expectation failures),
`.tmp/d3-restricted-gateway-vault-sql.log` (final 23-case pass),
`.tmp/d3-restricted-gateway-build.log`, `.tmp/d3-restricted-gateway-unit.log`.
Evidence uses PostgreSQL 16.6, generated candidates, offline AES/HMAC and simulated OIDC/vault
cipher authority, not live managed identity, AWS KMS, provider or ATS acceptance.

Owned tmpfs PostgreSQL fixture
`947486a0ad5a55d796153bfdba7e652083b1a21a627090a8621b4d24faae0283` was checked against its
exact ID/name/label/tmpfs and absence of mounts before removal. Shared volume inventories stayed
identical. Docker Desktop stopped and WSL reports no running distributions. This remains private
local WIP without full maintained-verifier, publication, activation or phase-completion claims.
Workflow fixtures, legacy transition, artifact isolation and clean full verification remain.

## Maintained Workflow fixtures and exact acceptance cleanup inventory

Five maintained Workflow integration modules now explicitly supply the shared per-module offline
packet authority to their owning Applications stores, retaining their original synthetic identity
setup, field policies and native/provider test transports. All 39 targeted PostgreSQL cases pass:
four preparation/starter/recovery modules pass 36 cases in the initial run; all three owning evidence
cases pass in a separate cluster. The initial multi-database cluster was deliberately rejected by
Jobs' public-reader direct-grant guard because the role had CONNECT on another fixture database.
The final evidence rerun uses an independent generated cluster; no migration or role guard is
weakened. These cases prove maintained fixture compatibility and ordinary accepted preparation
behavior, not native protected-value carry or actual cloud/provider execution.

Workflow build and all 1,613 unit cases pass (57 opt-in/database cases skipped in the unit run).
Logs: `.tmp/d3-restricted-workflow-sql.log` (initial four-module pass plus superseded evidence
setup failure), `.tmp/d3-restricted-workflow-evidence-sql.log` (final three-case pass),
`.tmp/d3-restricted-workflow-unit.log`. Scoped Biome passes for all five modules.

The Applications lifecycle acceptance utility's owning inventory now includes its three preparation
relations and both private packet relations for each exact fixture candidate. Its real PostgreSQL
fixture now creates a user-entered restricted boolean in every lifecycle packet. Both cleanup/
contamination cases pass with nonempty protected snapshots and read audit. Explicit checks prove
exact removal of the target's ciphertext/audit while preserving another candidate's counts and
original readable applied packet. The utility continues to invoke the authorized owning deletion
port and refuses contaminated boundaries. Applications build and all 314 units pass.
Logs: `.tmp/d3-restricted-lifecycle-cleanup-sql.log`, `.tmp/d3-restricted-lifecycle-build.log`,
`.tmp/d3-restricted-lifecycle-unit.log`.

Owned tmpfs fixture IDs
`018e72847dae7441268d60d19c76c6c851fd937f7734bda7374358ee48db0c46` and
`896f250e387ad9a6c33e99d91c7324860ac13915da294f976d1e46182cb672f4` were checked against
exact IDs/names/labels/tmpfs and absence of mounts, then removed. Shared volume inventories stayed
identical. Docker Desktop stopped and WSL reports no running distributions. All identities,
AES/HMAC keys, vault/provider/Lambda/S3/SQS transports and artifacts are synthetic/offline; no AWS,
managed OIDC, production grants, provider, ATS, deployment or activation evidence is claimed.

Source inspection identifies a remaining integration requirement: protected preparation carry in
`store.ts` currently obtains its synchronous metadata codec through the configured cipher boundary,
while the native preparation runtime intentionally has no packet cipher. The ordinary native cases
above do not cover this path. Complete exact metadata-only carry without granting native/provider
actors a decryption capability, and verify it through actual native composition and artifact isolation
before claiming the whole slice complete. Legacy transition and clean full verification remain.

## Native protected-packet carry without cipher authority

The synchronous exact protected metadata carry is now independent of the cipher factory. It retains
all original scope/version/job/form/field-policy/metadata/hash checks and copies the exact original
binding/fields without decrypt, re-encrypt or reference renewal. The store snapshots its owning
field definitions even when no cipher is composed. Inside the original preparation transaction,
the metadata-only native actor can finish already accepted protected packets; a configured private
writer still requires its existing enabled protection gate. New protected writes, keyed commands
and candidate/export reads retain their required private authority. No public port or feature flag
is enabled, and the pure carry helper remains absent from root exports.

The 11 actual isolated Documents preparation cases now seed a user-entered restricted false
answer. This exercises the native runtime with no packet cipher across normal execution, durable
replay, lost invoke acknowledgement and quarantine. Successful variants retain one original
ciphertext record, exact protected binding and a masked mandatory-review field, with zero read audit
and zero packet decrypt calls during preparation. A later authorized current candidate read returns
the original false value; the test clears the controlled map. Model calls exclude the restricted
field key. The original cancellation/provider acknowledgement and no-effect cases remain covered.
This replaces the preceding ordinary-only native evidence gap, without claiming cloud execution.

All 27 restricted-storage PostgreSQL regressions, 314 Applications units, 1,613 Workflow units and
both builds pass. Workflow unit run skips 57 opt-in/database cases; native SQL opt-in executes all
11 selected cases. Five emitted artifact-isolation checks pass: native preparation port/runtime/
starter/recovery exclude the packet KMS adapter, offline integration authority and AWS KMS client;
the isolated provider excludes Applications and all restricted packet modules. Logs:
`.tmp/d3-native-restricted-carry-sql.log`, `.tmp/d3-native-restricted-carry-storage-sql.log`,
`.tmp/d3-native-restricted-carry-unit.log`, `.tmp/d3-native-restricted-carry-workflow-unit.log`,
`.tmp/d3-native-restricted-carry-workflow-build.log`, `.tmp/d3-native-restricted-carry-bundle.log`.
These are source/dist emission checks; committed archive determinism is verified separately.

Owned tmpfs PostgreSQL fixture
`fa4c9e80de0cd9f7f693f084c627e956333125de04ce09c1192b41afd7a6d947` was checked against its
exact ID/name/label/tmpfs and absence of mounts, then removed. Shared volume inventories stayed
identical. Docker Desktop stopped and WSL reports no running distributions. No live KMS, managed
OIDC, AWS/provider/ATS invocation, production SQL/IAM authority, deployment or activation is claimed.
Legacy transition, broader artifact checks and clean full verification remain; private WIP only.


The native preparation artifact builds twice from clean committed source
`950860a547746a01f23a2430c119200197fe187c`. All five emitted files are byte-identical, including
the archive and companion provenance/SBOM/metadata. Each build executes the bundled default-off
refusal, closed-input rejection and zero-fetch checks. Logs:
`.tmp/d3-native-restricted-carry-artifact-first.log`,
`.tmp/d3-native-restricted-carry-artifact-second.log`,
`.tmp/d3-native-restricted-carry-artifact-hashes.txt`. Nothing is published or deployed. This proves
that exact local artifact; production key/role composition, legacy transition, broader artifact
verification and the full maintained verifier remain separate unfinished requirements.

## Actual historical migration refusal and rollback

A separately opt-in PostgreSQL fixture reconstructs the exact original eight-migration Applications
boundary from immutable SQL and LF-normalized recorded checksums after Profile migrations. It
requires a fresh, explicitly generated loopback database and rejects another target. Six independent
savepoint cases seed two original packet.v1 applications (approved and reconciliation-required),
original approvals, an ambiguous scope-holding attempt and replay receipts. Restricted false/true,
nonnull selected-vault values, a restricted policy reason, unkeyed create-packet receipts and
unkeyed preparation receipts each refuse migration 0009 with SQLSTATE 55000. Exact row comparison
across all eleven original Applications relations, function definitions and constraints proves no
rewrite, rehash, receipt change, partial private schema, column or function remains after rollback.
Each probe itself rolls back, so cases do not contaminate each other.

A compatible ordinary-packet case applies 0009 without rewriting original packet data/hashes,
approvals, ambiguous evidence or permitted ordinary receipts. Its newly added private binding/key
columns are null; the ordinary receipt's explicit legacy authority is sha256.v1. Private snapshot/
audit relations stay empty. A separate final case commits legacy restricted evidence and invokes
the actual current driver in another process. The full driver transaction refuses and exact original
rows/functions/constraints/eight checksum records remain intact, with no new private schema,
function or columns. All eight cases pass. Log: `.tmp/d3-restricted-legacy-sql.log`.
No production migration SQL, recorded historical checksum or admission guard is changed.

This verifies safe refusal and the supported ordinary transition. It does not migrate prohibited
legacy restricted evidence. Accountable disposition of any such real inventory is still required
before deployment/activation; neither silent deletion nor approval/ambiguous-evidence rehash is
permitted. The test does not read production data, invoke KMS, or authorize a legacy-data purge.

Owned tmpfs fixture
`641f6f954a55f10a547495e385f8d85737470a497b11591f800dcae446ee9edd` was checked against exact
ID/name/label/tmpfs and absence of mounts before removal. Shared volumes stayed identical; Docker
Desktop stopped and WSL reports no running distributions. Scoped Biome/build checks pass. The clean
full maintained verifier follows this committed evidence; it has not yet been claimed passing.

## Next work

Finish legacy migration compatibility and all maintained integration/runtime protection fixtures;
complete private artifact isolation and the clean full verifier before review. Production SQL/KMS
role grants, historical key composition and accountable/deployed acceptance remain separate gates.
Update all maintained integration/runtime fixtures for mandatory protection and complete the clean
full verifier before review. Existing legacy restricted plaintext must be handled by an explicit
reviewed transition; do not silently rewrite approved/ambiguous submission evidence. Retain exact
key authority for supported historical records; key rotation must never silently change replay
or approval semantics. Complete the whole storage path before requesting review of this slice.
