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

## Remaining work

Generate a wholly fresh reviewed plan and rerun the complete generated-synthetic direct-dark flow.
Do not reuse a claimed plan. Require all seven functional phases, rollback proof, privacy-safe logs,
zero persistent rows, exact object removal, zero running migration tasks, healthy alarms, disabled
triggers, receipt verification, and a refresh-backed zero-drift plan before recording acceptance.
API Gateway routing, JWT/JWKS/authorizer enforcement, GuardDuty service delivery, trigger activation,
managed OIDC, real resumes, and ADR-023 approval remain outside this dark acceptance claim.

