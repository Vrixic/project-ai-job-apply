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
uploaded bytes, requires that checksum in readback, and splits request, identity, checksum, and version
history into privacy-safe guarded stages. Documents 22/22, Gateway 108/108, both package builds and
typechecks, and focused PowerShell 7/5.1 operator suites pass. At that checkpoint, publication and the
deployed rerun remained open.

Exact source `7574059f2244bbe61e3555c9702777f3127332e2` is now published as a deterministic
Linux/AMD64 migration image with a complete zero-High/zero-Critical scan and as four immutable,
versioned, encrypted gateway release objects. Publication changed neither Terraform nor the active
gateway alias, and no migration ran. Docker and WSL were shut down immediately afterward. The AWS SSO
session expired before task-definition planning, so task/gateway plan and apply, fresh acceptance, and
zero drift remain externally blocked until the authorized operator refreshes that short-lived session.

## Remaining work

Refresh the authorized short-lived AWS SSO session, dark-release the already-published checksum-bound
source through exact reviewed task and gateway plans, then generate a wholly fresh reviewed plan and
rerun the complete generated-synthetic direct-dark flow.
Do not reuse a claimed plan. Require all seven functional phases, rollback proof, privacy-safe logs,
zero persistent rows, exact object removal, zero running migration tasks, healthy alarms, disabled
triggers, receipt verification, and a refresh-backed zero-drift plan before recording acceptance.
API Gateway routing, JWT/JWKS/authorizer enforcement, GuardDuty service delivery, trigger activation,
managed OIDC, real resumes, and ADR-023 approval remain outside this dark acceptance claim.
