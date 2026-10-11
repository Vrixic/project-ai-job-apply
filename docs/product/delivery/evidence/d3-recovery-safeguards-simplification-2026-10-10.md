# D3-103: Remove formal recovery-proof gates

Started: 2026-10-10. Status: Verified source; merge recorded in Git.

Owner-directed changes remove the mandatory physical restore rehearsal/receipt before development
dormancy and whole-database digest scans during completed-deletion replay. Abandoned formal
operator/provenance work is excluded. Existing verification tools remain optional diagnostics.

Preserved: available encrypted safety backup bound to the fresh database physical ID/KMS key,
final snapshots and automated backups, exact account/region/target checks, private restoration,
scoped locked plans and writer drain. Replay keeps serializable preflight revalidation, subject
and operation binding, owner deletion functions, all eight owner terminal checks and positive
COMMIT acknowledgement. Truthfulness, sensitive review, submission safety and expiry are unchanged.

Executed: 337 focused workflow tests across three suites, 34 lifecycle safety assertions,
workflow typecheck and 16 real PostgreSQL integration cases pass. Cases cover both retained
policies, idempotency, collisions, native withdrawals, terminal deletion and unrelated durable data.
Independent consequential review passes after fixing snapshot physical-ID binding. No full
repository checks were run.

The connected Chromium journey passes search -> Prepare resume/cover letter -> review -> approve
-> manual Apply -> candidate confirmation/history, downloads, expiry and withdrawal checks.
Authentication, BFF, native service and Chrome receiver are simulated. Installed extension, live
generation, external submission and candidate acceptance remain D3 work. Independent D1/admin
acceptance stays deferred.

Development AWS status verifies routes, schedules, mappings, queues and work drained; database
absent. No AWS runtime was activated. Docker and WSL shut down after PostgreSQL testing; PC on.
Retained storage still incurs costs. Private logs are under `.tmp/d3-recovery-simplification-`
with focused, typecheck, postgres, journey and off suffixes.