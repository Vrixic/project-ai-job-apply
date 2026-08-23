# D1 development document-processing remediation — 2026-08-23

## Outcome

Phase 1 document processing is not yet accepted. The current generated-synthetic direct-dark run
remains open, with every document trigger disabled and no real resume authorized.

Implemented and deployed remediation:

- Restored explicit JSON-text binding for the Documents idempotency and audit JSONB writes after
  live gateway execution exposed a regression to the PostgreSQL driver's JSON wrapper.
- Documents unit tests pass 22/22, Gateway tests pass 108/108, and both packages build.
- Published the exact `378f9059d36d0c6d41470dcca2fedc354c67ed23` migration image with two
  deterministic Linux/AMD64 builds and a complete ECR scan with zero High or Critical findings.
- Deployed only migration task revision 15 and gateway alias version 22 from exact saved Terraform
  plans. The task plan replaced only the one-off task definition; the gateway plan changed only the
  gateway function and alias. Document triggers and the anonymous public route stayed disabled.
- Corrected the acceptance operator's retained-parser boundary, initially empty recovery-set
  binding, privacy-safe stage attribution, and presigned-upload TTL proof. The TTL now binds
  `expiresAt` to `X-Amz-Date` for 300 seconds while admitting only the timestamp's sub-second
  precision loss. Focused operator tests pass in PowerShell 7 and Windows PowerShell 5.1.

## Failed-run and cleanup boundary

Earlier runs failed before gateway invocation, then exposed the live JSONB defect, then exposed the
operator's local-clock-dependent TTL check. Every such run either cleaned directly or was recovered
without an acceptance claim. The latest run progressed beyond registration but could not prove
object removal in its first cleanup attempt. Exact `RecoverCleanup` then proved:

- persistent database rows: `0`;
- database cleaned: `true`;
- recorded object versions removed: `true`;
- trigger activation: `false`;
- acceptance claim: `false`.

The recovered receipt SHA-256 is
`6b9d1863b4695b1ff90e30ba172a5833421e2eb1cb6ce7a43aab00692a5690d1`.
The ignored receipt, plans, fixture descriptors, object identities, account identifiers, and signed
upload fields remain local and are not copied into shared evidence.

A subsequent wholly fresh run reached `clean-pdf.upload-readback`. Its first cleanup attempt could
not prove object removal, and exact recovery then proved zero persistent rows, database cleanup, and
removal of every recorded object version with triggers disabled and no acceptance claim. The recovered
receipt SHA-256 is
`8f1b5b9fd73c5c884a5a49f603870095c19e2c02ec1fd3e2c27aea7c2cf6c53b`.

The upload signer had bound the candidate-provided SHA-256 only as metadata. The implemented source
remediation now adds exact `SHA256` POST checksum fields and policy conditions so S3 validates the
uploaded bytes, and splits request, identity, and version history into privacy-safe guarded stages.
Documents 22/22, Gateway 108/108, both package builds and
typechecks, and focused PowerShell 7/5.1 operator suites pass. At that checkpoint, publication and the
deployed rerun remained open.

After the authorized AWS SSO session was refreshed, exact current source
`22199f9db4c72b5397368c88948a7f70aed62bb8` was published as a deterministic Linux/AMD64
migration image with a complete zero-High/zero-Critical scan and as four immutable, versioned,
encrypted gateway release objects. Docker and WSL were shut down immediately after image publication.
Exact saved plan SHA-256 `547a3b57dfbc85dc046aee8a1e00e0c2f71fd93e4e01c4b41823738c1a5cb3f1`
replaced only the migration task definition, advancing it to revision 16. Exact saved plan SHA-256
`ed4d36d4cd6fae87a0c4cd8d60cdfca1d80603031fdcee6d34753ab8a2359312` changed only the
gateway function and alias, advancing the alias to version 23 without weighted routing. Development
state is serial 125. No migration ran and no trigger or public route was enabled.

The first checksum-bound dark run proved the signed upload was accepted, then failed specifically at
the checksum-enabled `HeadObject` request. Exact recovery again proved zero rows and exact object
removal with no acceptance claim. The operator now preserves least privilege: successful signed POST
is the S3 byte-checksum proof, while standard metadata-only `HeadObject` proves version, size, media
type, encryption key identity, and registration metadata without granting the human operator candidate
document KMS decrypt permission. A fresh run remains open.

A second fresh run showed that even standard unversioned `HeadObject` is denied while exact cleanup's
version-bound readback succeeds. The operator now follows that stronger successful boundary during
normal execution: list and prove exactly one version with no delete marker, then read and record that
exact version. This removes reliance on current-key permission or resolution and keeps cleanup bound to
the same reviewed version. A new fresh run remains open.

The next fresh run passed upload readback and reached direct processor response validation. Its recovery
then exposed an operator-only response-shape defect after exact version deletion: S3 can omit the
optional false `DeleteMarker` field. Cleanup now reads that field optionally under StrictMode while
still rejecting an explicit delete marker or wrong version. Exact recovery of that run remains the
immediate prerequisite before processor diagnosis or another plan.

Recovery completed with zero rows and exact object removal. The only processor application error was
the privacy-safe `TypeError` code. Source inspection found that the processor audit paths still used
the same PostgreSQL JSON wrapper plus explicit `::jsonb` pattern already proven defective in live
gateway registration. All processor JSONB audit writes now bind explicit serialized JSON text. Focused
Documents verification passes 22/22, typecheck and build pass, and a disposable PostgreSQL 16
processor integration run passes 2/2 before its exact test database is removed.

Exact source `3c04be7b46853b9d88b9556827838325b8f2cc65` was then published as a deterministic,
scanned migration image and immutable versioned Documents/Gateway objects. Saved plan SHA-256
`4ed399af691ca1f3cc1c1d3e897122108222e87226685005654062c0eaf6f70d` changed only the
migration task definition and the parser, processor, and gateway functions plus their unweighted
aliases. The apply advanced the migration task to revision 17, parser and processor aliases to version
4, gateway alias to version 24, and state to serial 127. Live artifact digests match the publication
receipts. The scan mapping and both rules remain disabled, activation remains unauthorized, the
anonymous public route remains absent, and no migration ran.

A wholly fresh plan bound the four fixed generated-synthetic fixtures, eight reviewed requests, and
the exact dark runtime. Its execution-plan SHA-256 is
`d66ff2124d01cbe44f387880f8dd5308df3f13f64e8fa8e262817862b7af9e96`. The run reached
direct processor response validation and failed closed. Receipt SHA-256
`21c5392a61de31e0e67c0b4a16192f20fb91b51cc66e105caf6d4d692721fa9b` records
`failed-cleaned`, zero persistent rows, database cleanup, exact object removal, and no acceptance
claim. The only value-free processor error was `PackedPolicyTooLargeException`: AWS STS rejected the
per-object parser session policy's packed representation even though the plaintext policy stayed
within its separate documented limit.

The source remediation now preserves the exact source object and version plus exact normalized
output while reducing packed-policy pressure. The source read uses `s3:GetObject*`, whose effective
permissions remain capped by the object-access role to the four reviewed read/tag actions, and the
normalized object grants only `s3:PutObject`. The KMS key and S3-only condition are unchanged. A
regression asserts those exact actions/resources/conditions and keeps the serialized policy below a
conservative 1,024-character ceiling. Documents unit tests pass 22/22, and typecheck and build pass.
Exact source `4577fbcd32602cdb28bb4107a45a3f936bf88779` was published as a deterministic,
zero-High/zero-Critical migration image and immutable document artifacts. Saved plan SHA-256
`e052ed811d4356e94ea54de7181e0f32c5e07349ea64fdb76d5fc89d360c7661` changed only the
migration task definition and processor function/alias, advancing them to task revision 18,
processor version 5, and state serial 128. Live digest and no-weighted-routing checks pass; all
triggers remain disabled and no migration ran.

A new exact run used execution-plan SHA-256
`8121b379f08ce82309652c18362cfc71e2f6474d330abe1d71788371488bbdb0`. STS accepted the
minimized policy, but the retained Terraform-pinned parser version 2 rejected the generated clean PDF
as `invalid_document`; no candidate value was emitted. Receipt SHA-256
`48a73282629568dbb4851e3e13d06c3bb62c08702b9a31eeecd78dc43ef6bb48` records
`cleanup-required` with no acceptance claim. The first exact recovery task also failed closed because
cleanup admitted `invalid_document` only for the intentionally invalid fixture. Read-only, task-
revision-18 diagnostics used the same authenticated run environment, forced PostgreSQL read-only,
emitted only a static error-message digest and aggregate fixture disposition, and changed no row.

Cleanup now admits an authenticated clean PDF or DOCX rejected as `invalid_document` while retaining
the exact fixture manifest, identity, registration/idempotency/audit ownership, version, and unrelated-
state refusal checks. The new real PostgreSQL regression covers that partial state and passes 7/7;
Documents unit tests remain 22/22 and typecheck/build pass. A recovery-capable migration image must be
published and used for bounded cleanup before any new execution. The next runtime plan must also repin
the processor from retained parser version 2 to already published, unweighted parser version 4.

Exact source `a7b15f6f5bf8716e877b16b660d9f9109d79306b` was published as a deterministic,
zero-High/zero-Critical migration image. One temporary task revision cloned revision 18 except for that
reviewed image, cleaned the exact authenticated partial run with zero persistent rows, and was
deregistered. The original operator then independently re-proved the empty database boundary and
removed the descriptor-bound source version. Recovered receipt SHA-256
`2a70574ae1ac456c96670eb28dc1bb0ee50b39c8c02e427428de53f688c5afe4` records zero rows,
database clean, objects removed, triggers disabled, and no acceptance claim.

Saved plan SHA-256 `d08e797d1389f9ed21efee657216ed803ba2969705c46dfdea6ccd25dcc5128b`
then advanced the migration task to revision 20, processor alias to version 6, and state to serial 129.
It changed only the task image, processor function/alias, and exact parser-version substitutions in
the processor IAM and Lambda VPC-endpoint policies. The processor is pinned to unweighted parser
version 4; no action/resource broadening, trigger, public route, or migration occurred.

A fresh exact parser-4 run used execution-plan SHA-256
`850fe0435bb53c70ea90b65b4ce10d0f2a2c10e23fc9ca86c3ce4c1c9b1c1162` and again stopped at
processor response validation. Receipt SHA-256
`2290477c0a49a05bed340c3167bc54d7c99d6a77bd4816c6503ec926c520792c` records
`failed-cleaned`, zero persistent rows, database cleanup, exact object removal, and no acceptance
claim. Lambda metrics prove two successful processor invocations with zero errors and one successful
parser invocation; the parser completed in bounded time but returned a rejection that the processor
acknowledged without telemetry. Source now emits only the already validated parser `failureCode` and
uppercase `reasonCode` in a value-free `document_processing_parser_rejected` event. An exact unit
regression covers that boundary. Publication and a wholly fresh run remain open.

Exact telemetry source `a09bf43747e3e639f692d0e09e96c50fd9847174` was published as a
deterministic, zero-High/zero-Critical migration image and as immutable Documents artifacts. Saved
plan SHA-256 `9fc6a7b0588cf82b3eb9127c0fe242319248eb5c7a41171a93a1c3613178e1c6`
changed only the migration task definition and processor function/alias, advancing them to task
revision 21, processor alias version 7, and state serial 130. Parser version 4 stayed pinned and
unweighted. All document triggers and the anonymous public route stayed disabled, and no migration
ran.

The fresh run used execution-plan SHA-256
`62fd81236d230a8b580f2f0e4378f16f95b79b86ca4a12ae023495d805fc3dc3`. It again stopped at
processor response validation, but the new bounded event identified the retained parser result as
`invalid_document` / `PDF_PARSE_REJECTED` without candidate content or object identity. Receipt
SHA-256 `c37f286cad63a7fa3102d8d3e819e76f1542aaf1caa8ee8292225319cd39bc17`
records `failed-cleaned`, zero persistent rows, database cleanup, exact object removal, and no
acceptance claim.

The deployed-only parser defect is now reproduced before publication. The AWS SDK download body is a
Node `Buffer`; pdf.js rejects `Buffer` even though it is a `Uint8Array` subtype, while the earlier
source harness supplied a plain `Uint8Array`. The S3 boundary now copies every bounded body into a
true `Uint8Array`. The single-file Lambda bundle also embeds and initializes pdf.js's worker instead
of relying on a worker file absent from the ZIP. The artifact builder now invokes an exported
verification hook against a structurally valid PDF and fails the build unless the produced bundle
extracts the exact expected text. A parser-boundary regression exercises a Buffer-backed AWS body.
Documents unit tests pass 23/23, typecheck and Lambda build pass, and two consecutive parser artifact
and bundle digests are identical. Publication and a wholly fresh run remain open.

Exact remediation source `6daa4215c2a52428b4dcecb5fc7ebc1fe1329094` was published as a
deterministic Linux/AMD64 migration image with a complete zero-High/zero-Critical scan and as two
deterministic Documents artifacts/eight immutable encrypted objects. Migration receipt SHA-256 is
`4d71093f90655ece396c6b4d68c49601282120ab18aaac3da574fccf46f3a61a`; Documents receipt
SHA-256 is `504bd706b28bf19991b4aea4fe891e834b9bc88eb0e809c50008d0eaed1acc3e`.
Docker and WSL were stopped immediately after image publication.

The dark release was intentionally split so the processor could not transiently publish while still
pinned to retained parser version 4. Stage-one saved plan SHA-256
`8c2141347759a49c56c32db78418f5ec62a18a946e262459301b1e2758aa05a7` replaced only the
migration task definition and updated only the parser function/alias. Stage-two saved plan SHA-256
`8766937760c33c4279dca98f8404860c4b706c1489ba0aebc1ce8a389c75d5f0` updated only the
processor function/alias and substituted the exact parser version in the processor IAM and Lambda
endpoint policies without changing their action sets. The deployed state is serial 133, migration
task revision 22, parser version/alias 5, and processor version/alias 8. The processor pin exactly
matches parser version 5; aliases have no weighted routing, and the mapping and both rules remain
disabled. No migration ran and no public route was enabled.

A wholly fresh run used execution-plan SHA-256
`590746c916da790834ce900d720912dcb35b49f5db9e75e76f25438c47b0d0a2` and fixture-set
SHA-256 `ed232bcf83dbdd86cc16067c4f42a88fcc495559abc5aa23811909198b9671c0`.
It passed preflight and the complete clean-document phase: both clean fixtures produced bounded
`document_processing_completed` events, and the acceptance task proved two parsed documents, three
proposed facts, and the exact reviewed aggregate. The run then failed during the first profile-review
gateway boundary before the reviewed-state task. Exactly one gateway alias invocation occurred with
zero Lambda errors. Receipt SHA-256
`e1fabad4703311a502661d294532dd8562e7a07110215e6e39aa1053322bb741` records
`failed-cleaned`, zero persistent rows, database cleanup, exact object removal, and no acceptance
claim. This proves the bundled parser blocker is closed but does not complete direct-dark acceptance.

The operator previously collapsed initial profile read, aggregate, fixed synthetic proposal,
mutation-response/version, and final-state validation into one generic gateway response stage. It now
attributes each boundary with a fixed value-free stage name, including separate expected synthetic
email, TypeScript, and PostgreSQL proposal checks. The source-only regression requires every new stage
and does not expose values, identifiers, response bodies, or arbitrary paths. A fresh operator-delta
run remains open to isolate the exact profile-review defect before correction.

The exact allowed operator delta was committed at
`db89aa0c9a962d1ae6814b6ce270742b8e93f75c` and independently bound in a new plan. Execution-plan
SHA-256 `b6b0573249909eba39ca24b5025d061d69dc32195f076985cf5a3982b42db2a9` used fixture-set
SHA-256 `75a7ae14a5f86da944206b53014b9a247e114df0b813c3da45a9e9b5b5e2db5d` against unchanged
state serial 133. The run again passed preflight and clean processing, then the new attribution
isolated `profile-review-initial-read-response-validation` before any review mutation. Receipt
SHA-256 `c215bf228b72458cd02aa2ae901d61a81b46136328760e6f08b33bf69f40d2c7`
records `failed-cleaned`, zero persistent rows, database cleanup, exact object removal, and no
acceptance claim.

The defect is in the acceptance operator rather than the deployed gateway or profile data. Its event
builder always serialized `body: null`; the gateway intentionally treats any body property on a GET
as an invalid bodyless request and returns `400`. The operator now omits `body` entirely when no body
is supplied while preserving exact compact JSON for POST/PATCH. An executable regression asserts the
bodyless profile GET has no `body` property and the upload POST retains its exact JSON body. A fresh
operator-delta run was generated from committed operator source
`8533009fa7c992fd4b8f15e856d2e5303d908793`.

The fresh plan used execution-plan SHA-256
`cf991718a755a535e7337d36ae68ba6038fcc93e539deebdfd00f24e11b40dd5` and fixture-set SHA-256
`4f95463c754a5831913f544292011a1b2e03fa0333132d8190001054746ab064`. All seven tasks and
result actions completed, the database cleanup reported zero persistent rows, and rollback was
proved. The run remained non-claiming because exact object cleanup stopped after deleting the first
normalized version. Receipt SHA-256
`1ee20bf4de0fac04dbfc449477972d21e029c50cb770a170c479841187551676` records
`cleanup-required`, zero persistent rows, proved rollback, and database cleanup, but not complete
object removal.

Read-only inventory proved the remaining descriptor-bound versions were still uniquely listed. The
source fixture later used for the contradiction phase and the harmless malware-disposition fixture
were intentionally unreadable after receiving the synthetic threat tag. Cleanup incorrectly required
`HeadObject` after exact version-history matching, so it was incompatible with the quarantine policy.
The cleanup path now revalidates the full reviewed runtime identity and deletes only the exact
descriptor-bound version returned by the unique history check; it still validates the delete response
and requires zero versions and zero delete markers afterward. It no longer requires content-read
permission. PowerShell 7 and Windows PowerShell 5.1 regressions prove cleanup performs no additional
head read while preserving exact deletion and idempotent already-absent behavior. Exact recovery of
the retained versions completed under committed operator source
`9477e6a00b642c21852d5120e28a9f649f6fae0d`. The updated recovery receipt SHA-256 is
`9dad04b9e7ba2ebc0753b7d789c37e921362f522bdec7364bd5a7cb198d6dffb`; it records zero
persistent rows, database cleanup, exact object removal, no trigger activation, and no acceptance
claim.

A wholly fresh run then used execution-plan SHA-256
`e5de1bf1e604cfaf33c01fa1b4edcee6c5c34db44a2e57d95ccfa208d6d68d67` and fixture-set
SHA-256 `760702163334a95ab5eb4adcc917aa4e8998ea557226d88fbb53442ba28cb0d7` against unchanged
state serial 133. It completed all seven actions, proved rollback, cleaned the database to zero rows,
removed every exact object version, and kept all triggers disabled. Receipt SHA-256
`c17b7b809809b551d250db4969024c22bc854da4b5b780fa1a4276125aa544ee` records the first
functionally verified-and-cleaned run.

Separate receipt verification nevertheless failed closed at the privacy-log gate. The ECS acceptance
task's one-line aggregate included the generated run identifier even though its unique task/log-stream
identity and exact reviewed environment already bind the run. The runtime result now passes through a
typed privacy-safe projection before logging: action, aggregate counts, rollback result, and canonical
digest remain, while `runId` is omitted. The canonical digest continues to bind the internal run ID,
fixture set, profile digest, and document rows. The operator requires the reduced exact result schema.
Documents unit tests pass 24/24, typecheck passes, and the PowerShell 7/5.1 operator regressions pass.
No direct-dark acceptance claim is made until this source is published, rerun wholly fresh, and its
receipt passes independent verification.

Exact privacy-remediation source `b5ec816e37d3a3117f438915727eacba76000921` was published as a
deterministic Linux/AMD64 migration image with a complete zero-High/zero-Critical scan. Publication
receipt SHA-256 is `9130ad65fef73b7e70940e61fcf1132d419eada1fcb8926599690aca89f0d407`.
Only the migration task definition was replaced, advancing it to revision 23 and state serial 134;
the exact image digest matches, triggers remain disabled, and zero-drift plan SHA-256 is
`f0e984b8a5a82c8fd519961c2e3522b185bf50bf05ca654c50da3e921bbb1e23`. Docker and WSL were
stopped immediately after publication.

The wholly fresh run used execution-plan SHA-256
`308c5d10b874c39407885dbb23c720a5773094bee455bf66133dea2a22b019db` and fixture-set SHA-256
`38ca25353630bffacd3742aaceb4e8319c64483792f6b3f3adb93ef34e28f8a7`. It again completed all
seven actions, proved rollback, cleaned the database to zero rows, removed every exact object version,
and kept triggers disabled. Receipt SHA-256
`7610b70e0d6739265a368154c4b71cc11b1536e388f276685d1e43cede8b2a45` is functionally
verified-and-cleaned. Independent verification passed the privacy gate, then failed closed because the
contradiction event did not have the exact root shape expected by its metric filter.

The deployed processor used `console.error(JSON.stringify(...))` while Lambda advanced logging is
configured for JSON. Lambda therefore stored an outer structured record whose `message` was an inner
JSON string; all three root-field document metric filters were structurally unable to match. The
processor and reconciler now pass a single bounded object to each console method. The metric filters
match `$.message.event`, and the verifier parses the outer record and requires the contradiction
payload to contain exactly the one `event` property. Documents 24/24, typecheck, Terraform formatting,
and PowerShell 7/5.1 regressions pass. Publication and a wholly fresh run remain open.

## Remaining work

Commit and publish the structured-telemetry correction as both the migration image and Documents
artifacts. Dark-deploy only the resulting task definition, processor function/alias, and three metric
filter pattern updates, then generate a wholly fresh reviewed plan and rerun the complete
generated-synthetic direct-dark flow.
Do not reuse a claimed plan. Require all seven functional phases, rollback proof, privacy-safe logs,
zero persistent rows, exact object removal, zero running migration tasks, healthy alarms, disabled
triggers, receipt verification, and a refresh-backed zero-drift plan before recording acceptance.
API Gateway routing, JWT/JWKS/authorizer enforcement, GuardDuty service delivery, trigger activation,
managed OIDC, real resumes, and ADR-023 approval remain outside this dark acceptance claim.
