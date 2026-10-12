# D3 retired-epoch reprepare — 2026-10-12

D3-115 fixes a source-backed cause of the synthetic reprepare failure: retirement left the
admission head unsealed, so a new generation reused its unique epoch. The live dispatch reported
one pending request and zero starts; the original SQL exception was not captured.

A fresh admitted request now locks the head, requires its exact resume generation to be positively
settled and refuses every nonterminal resume generation or material allocation. It seals the old
epoch with one database timestamp and uses the existing guarded reopening path. Existing-generation
replay takes its original branch. Expiry alone cannot authorize replacement; original claims,
task bindings, references and deadlines remain immutable. Owner, revision, job, withdrawal and
quarantine checks remain in the existing reservation path.

Executed against an isolated loopback PostgreSQL 18.1 database: five targeted cases pass for
retired replacement/replay, bound/pending/unknown refusal and competing fresh requests. The
Documents component build (including TypeScript checks) and two-file Biome checks pass. A missing
test-event guard found by the initial build was corrected before the passing retry. Independent
consequential source review passes. No full repository checks were run. The isolated database was
stopped after testing; existing PostgreSQL services were preserved.

The connected Chromium journey passes search → Prepare → review → approve → manual Apply →
candidate-attested confirmation/history, with expiry, downloads, transfer withdrawal and keyboard
checks. Authentication, BFF, native service and Chrome receiver are simulated. This is not live
generation, installed-extension or employer-submission acceptance.

Private execution evidence: `native-retired-epoch-postgresql-20261012.log` (5 passed, 76 skipped),
`native-retired-epoch-build-20261012-retry.log`, `native-retired-epoch-biome-20261012.log`,
`native-retired-epoch-connected-journey-20261012.log` and the focused independent review receipt
under `.tmp/d3-primary-recovery-20261010/`.

Deployment and a successful live native preview remain required. Live AI stays off because no
provider/account policy meets the 30-minute all-copy limit. Employer submission stays off pending
authorized ATS QA/fixtures and grants. Independent D1/admin acceptance remains deferred.
