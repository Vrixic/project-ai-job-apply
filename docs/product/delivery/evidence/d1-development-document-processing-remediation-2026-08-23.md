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

## Remaining work

Publish the value-free parser-rejection telemetry, dark-release the processor, then generate a wholly
fresh reviewed plan and rerun the complete generated-synthetic direct-dark flow.
Do not reuse a claimed plan. Require all seven functional phases, rollback proof, privacy-safe logs,
zero persistent rows, exact object removal, zero running migration tasks, healthy alarms, disabled
triggers, receipt verification, and a refresh-backed zero-drift plan before recording acceptance.
API Gateway routing, JWT/JWKS/authorizer enforcement, GuardDuty service delivery, trigger activation,
managed OIDC, real resumes, and ADR-023 approval remain outside this dark acceptance claim.
