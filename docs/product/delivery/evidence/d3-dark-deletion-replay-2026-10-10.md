# D3 quiescent deletion replay — 2026-10-10

The deletion-replay operator's normal preflight requires the live application runtime. Its
default-off development `-DarkRecovery` path now uses the maintained quiescent PITR Status
checks instead: fresh exact-input zero drift, application writers stopped, protected source and
one verified isolated restore. Every replay action, including cleanup, must retain this mode.

The preparation binds the mode, separate dark context and eleven files, including the three
recovery operator/helper dependencies. Legacy packets remain steady-state only. Changed modes,
stripped fields, missing dependencies and noncanonical safety evidence refuse before invocation.
Existing exact target, role, immutable artifact, explicit execution, ambiguity journals and
original 30-minute expiry rules remain in force. No runtime configuration contract changed.

All 778 synthetic replay checks pass. The initial focused run exposed a test-harness defining-file
path error; the corrected harness dot-sources the actual extracted functions from a temporary
file, preserving PowerShell automatic paths. All 908 restore-role assertions and all 43 repository
stages pass on source commit 4aca568a135ec0fe62ce2a0a376cabcc4f8ac57a. The ignored full log
SHA-256 is a57c779d51c84776a596146e31722e9b9f6583fde1c9c7348bdd864efbb8bf0c. The focused log
SHA-256 is b90d5df9796343e4cb0333bff4cb7f4dc65fe65dc1401d5767deae58cd8185cc.
Independent source, test-log and delivery-record review passed with no blocking findings.
These tests do not prove managed replay, source promotion or connected candidate acceptance.

No AWS test runtime, Docker or WSL was started; the PC remains on. Retained recovery/storage/
security resources incur charges. Staging was not accessed. Independent D1/admin acceptance is
deferred. See the [operator runbook](../../../../infrastructure/runbooks/restore/candidate-deletion-recovery-replay.md#guarded-execution).
