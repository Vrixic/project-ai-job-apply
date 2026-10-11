# D3 primary deletion manifest fingerprint — 2026-10-11

D3-112 corrects a stale label discovered before creating the basic completed-deletion executor.
Primary replay verified the current embedded 80-migration schema, including Documents 0017, but its
configuration and schema result carried the prior 79-migration manifest fingerprint. Primary context,
PowerShell/TypeScript admission and current-schema verification now bind the actual current source
fingerprint. Primary admission rejects the old fingerprint. Historical isolated configuration and
fixtures remain unchanged; independent optional recovery-proof work stays deferred.

311 focused contract, Lambda and schema tests, 51 primary and 790 retained cross-runtime PowerShell
checks, component typecheck and changed-file Biome checks pass. Regressions bind actual manifest
bytes/count/0017, the producer/consumer fingerprints, and rejection of the old primary label. Existing
expiry, cancellation, writer-off and transactional deletion safeguards remain. Consequential source review passes; managed replay
requires a fresh source-bound executor build; the earlier prepared packet was never
created or invoked and must not be reused.

The immutable migration task 67 has stopped with exit 0 and all seven service owners verified,
including Documents 0017. Compatible Gateway 98 and cleanup 4, their disabled ingress and temporary
replay authority match the reviewed managed plans. Candidate traffic remains off during this test
batch. Data-preserving AWS shutdown remains required before handoff. Docker/WSL are off; the PC stays
on. Native generation and employer submission are not accepted. AI retention policy and authorized
ATS QA/fixtures remain unavailable; independent D1/admin acceptance stays deferred.
