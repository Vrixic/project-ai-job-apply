# D3 quiescent privacy recovery — 2026-10-10

The normal PITR operator requires live public endpoints and active workflow triggers. Candidate
deletion recovery requires writers off. An explicit default-off development-only `-DarkRecovery`
path now substitutes exact-input zero-change/zero-drift verification and fresh writer drain for
HTTP, trigger and alarm health. Staging refuses the switch before AWS calls.

Every action retains the existing private encrypted protected source, 35-day backups, immutable
read-only verifier and exact target/source/network guards. New contexts record their mode in a
separate ignored file; legacy contexts remain normal only. Writer checks cover public routes,
rules, queue consumers, Scheduler, ECS services and RUNNING/PENDING tasks, all durable functions,
and queued/in-flight/delayed work. Checks surround the original verifier, including timeout
cleanup, and precede restore/delete requests. Emergency cleanup retains exact-target safeguards.

The fresh Terraform plan must be complete, error-free and nonapplyable, with no resource/output
changes or drift. The operator reconstructs the complete current root input inventory and
restores process inputs in `finally`. Optional native fields may use only their documented
`optional(bool, false)` defaults; malformed mandatory values refuse. Candidate-rights
infrastructure, immutable releases and retained read/replay permissions remain available under
writer-off gates. Implicit variable/override/JSON configuration files are refused.

All 98 focused synthetic cases pass, including malformed identifiers, canonical booleans, nested
activation, context persistence/mode changes, missing evidence, exact backend binding and failed
plan cleanup. The full 43-stage repository verifier passed on source commit
ef03d6e03dba9a875142d8b1d2ce5276575b5455. Its ignored local log SHA-256 is
98f7f46af190356e09029924265984baaa5e54a59c33e0e1b410470af575383c.
Both PowerShell 7 and Windows PowerShell 5.1 focused suites passed; the latter required
preloading the available Get-FileHash command after an initial command-resolution failure.
Independent source, test-log and delivery-record review passed with no blocking findings. No managed
PITR, source recovery, privacy replay or live candidate acceptance is claimed by these tests.

Development test runtimes, Docker and WSL remain off; the PC remains on. Retained recovery,
storage and security resources incur charges. Staging was not accessed. The protected source
must be separately recovered before managed privacy testing. Independent D1/admin acceptance
remains deferred. See the [operator runbook](../../../../infrastructure/runbooks/restore/development-postgresql-point-in-time.md#quiescent-privacy-recovery).
