# D1 managed-OIDC saved-job workload foundation — 2026-08-24

## Outcome

Exact source `1d10656607c3f00c3015f8cfb1770783f9b4d01f` adds the missing bounded deployed
write/failure/recovery workload foundation to the local-only D1 conformance surface. It preserves
the existing read profile and requires a separate explicit confirmation before any mutation.

No authenticated workload ran in this record. The approved synthetic account still must complete
the managed-OIDC interaction and both exact windows must be corroborated in AWS before deployed
workload acceptance can be claimed.

## Fixed lifecycle boundary

The server-held session performs the following sequence against the already configured development
API Gateway origin:

1. Read and schema-validate every bounded canonical-job and owner-scoped saved-job page.
2. Select two catalog jobs that were not already saved by the synthetic account. Existing saved
   associations are never selected for deletion or overwrite.
3. Create one saved association with a fresh server-generated idempotency key and validate the
   complete generated `SavedJob` contract plus `no-store` response.
4. Replay the same command and require the exact saved-job identity.
5. Reuse the key with the second unsaved job and require the generated `ProblemDetails` contract,
   HTTP `409`, and exact `idempotency_conflict` code.
6. Read the owner projection and require the created association exactly once.
7. Delete that exact association and require its absence on a complete paginated reread.

If an assertion fails after selection, the runner rereads the owner boundary and attempts to delete
only the selected association. The inconclusive response reports only whether cleanup was attempted
and succeeded. A failed cleanup is a stop-and-reconcile condition, not permission to retry.

The saved association is removed, but Matching's bounded idempotency replay record and append-only
saved/unsaved audit events remain by design. The account is synthetic; no real candidate data is
authorized. Results retain only profile name, timestamps, duration, aggregate page/count outcomes,
and cleanup booleans—never a token, identity, job identifier, saved-job identifier, body, or private
value.

## Verification

- Focused workload/panel tests: 12/12.
- Complete web tests: 38 files and 503 tests.
- Complete repository typecheck: 31/31 tasks.
- Complete repository build: 19/19 tasks.
- Scoped formatting/lint and whitespace checks pass.
- The live development launcher preflight passed its AWS/Terraform/Auth0/API Gateway, durable-dark,
  idle-ECS, and `200/200/401` prerequisites.
- The opt-in page returned `200` with the new control. A same-origin, correctly confirmed lifecycle
  request without a managed session returned `401` before deployed product traffic.
- The repository-approved browser controller was unavailable in this Codex session. No credential
  was requested, observed, or handled.
- The temporary Next server was stopped and its generated agent files were removed. Docker and WSL
  were not started.

## Remaining acceptance

Use the approved synthetic account to execute the 150-public/100-authenticated read profile and the
saved-job lifecycle profile. Retain only both aggregate windows, corroborate each through the
read-only development workload inspector, and require healthy alarms, zero unexpected API/Lambda
failures or throttles, idle ECS, empty queues, privacy-safe logs, and zero drift.

This foundation plus the already accepted persisted disabled-source failure settlement covers the
technical profile shapes. It does not establish a production SLO, capacity limit, human browser or
assistive-technology acceptance, independent security/privacy approval, product acceptance, or
Phase 1 completion.

[Runbook](../../../../infrastructure/runbooks/observability/development-d1-read-workload.md)
