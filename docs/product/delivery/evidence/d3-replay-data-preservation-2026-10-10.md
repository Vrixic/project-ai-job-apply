# D3-099: Transactional replay data preservation

Started: 2026-10-10. Repository batch completed: 2026-10-10. Status: Complete for repository implementation only.

Replay source now hashes the complete fixed 96-relation inventory inside PostgreSQL, with exact
authorized deletion projections. It compares unrelated whole rows before and after deletion in
the same serializable transaction, then fingerprints the complete reconciled copy. Only hashes,
counts and versioned metadata leave SQL. Work shares fixed row, byte and deadline bounds;
cancellation, changed data or commit failure produces no attestation. Original expiry is unchanged.

The real PostgreSQL run exposed an exact-marker request restored before confirmation: its
operation is legitimately null. The predicate now includes only that exact user's/request's
constrained requested/null state alongside the exact operation binding. Existing preflight
collision checks remain. This fixes a false preservation refusal without exempting unrelated
same-user requests.

348 focused tests, 790 generated operator assertions, 11 isolated PostgreSQL regressions and all
43 repository verification stages pass from source `6562094cc2c0db1b6b927ed21a2a27135e453526`.
Original full invocation 83483 completed with exit 0; log SHA-256:
`4b8082eee6d8fcf7dcf632ab18b2c243f3b7de5442954fa14810f066d8e3db97`.
The real PostgreSQL regressions cover same-user unrelated records, nullable/deletion audits,
same-count value changes and complete rollback after injected unrelated corruption. PostgreSQL
16.6 runs in an owned loopback/tmpfs container with generated fixtures and simulated KMS. Their original
invocation 16145 completed with exit 0; log SHA-256:
`c430fece83d5e9eef3b7a7fd169087fabfcf3b336745c08959843067c33c9788`.
Independent source and PostgreSQL result review pass. Earlier failing runs are retained privately;
they are not passing evidence. [PR #632](https://github.com/Vrixic/project-ai-job-apply/pull/632).
Hosted quality jobs did not start: GitHub reports account payment/spending-limit restrictions.
This is an external hosted-check blocker, not a reported test failure. CI configuration is unchanged.

The simulated Chromium journey also passes search, Prepare resume/cover letter, review, approve,
manual Apply, candidate-confirmed submission/history, expiry, disconnect and approved downloads.
Its log SHA-256 is `556bcb32c6dae55b89929ab89979c0d6ef20b8c5e04fe6a0af0f09d39b4595c7`.
Authentication, APIs and native previews are simulated; no live generation or external submission
is claimed. This source batch does not change the candidate-facing journey.

Development shutdown is independently reviewed: primary and physical restore-check instances are
absent; final snapshot `ai-job-apply-development-shutdown-20261010210417` is available and encrypted
with the exact original source lineage. Fresh maintained verification reports no actions or drift
across all 143 inputs (plan SHA-256
`a55f4c0c4d3497f6c2193660033e2644e7052031c1fcfa7417a09ef0ce4d00fb`).
Routes, triggers, queues and active work pass maintained drain checks. NAT gateways, interface
endpoints and Elastic IPs are absent. Exact dormant inputs and physical proof are archived in the
versioned state bucket with its KMS key; both version-specific readback hashes match. Safety/final
snapshots, automated backups and other durable/control-plane storage remain and can incur charges.
This physical recovery evidence does not establish privacy replay. Docker and WSL are verified off;
the PC remains on. Staging was not accessed during this batch.

This batch is transactional preservation only. The dedicated snapshot selection, primary
promotion, fresh postrestore proof, managed privacy replay and connected candidate journey remain
internal work. [ADR-048](../../../adr/048-privacy-reconciled-development-recovery.md) is proposed;
no ordinary restore/cleanup guard is relaxed. Independent D1/admin acceptance stays deferred.
