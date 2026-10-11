# Candidate deletion recovery replay

Use this development-only operator against the exact private, quiesced PostgreSQL copy created
and verified by [the maintained PITR procedure](development-postgresql-point-in-time.md). The
restore must remain outside every application route and trigger. Structural verification and
deletion reconciliation are separate operations; neither alone proves recovery acceptance.

## Implementation and activation boundary

[The operator](../../../scripts/operate-development-candidate-deletion-replay.ps1) creates one
temporary, version-qualified private Lambda with no URL, alias, queue mapping, resource policy,
or schedule. It uses a fresh one-connection PostgreSQL pool per invocation. Credentials are
resolved only inside that Lambda through the local Secrets extension; only the authenticated
target hostname is substituted into the exact source secret. Never supply a database URL,
candidate identity, object key, SQL, Auth0 credential, or caller-selected endpoint.

The dedicated `candidate_deletion_restore_role_enabled` flag defaults to false. Its separately
reviewed development bootstrap boundary and platform role/private-endpoint allowances must be
deployed before preparation. They do not activate candidate rights, alter an existing role's
effective permissions, or create the executor. Do not enable this flag in staging or production,
reuse a live mutation-capable rights role, or override the migration task into replay.

Use `scripts/operate-development-deletion-restore-role.ps1` for the separate temporary permission
transition. It requires current portable Terraform 1.16.2, the exact encrypted S3-locking backend,
clean merged source, current state lineage/serial and a reviewed zero-change baseline. Run
`-Stage Bootstrap -Transition Enable` through `Plan`, reviewed `Apply -Execute`, and `Verify`,
then the same sequence for `-Stage Platform`. Each plan changes only the named restore flag and
its exact policy/role/endpoint effects; it must preserve maintenance, artifacts, reviewer/provider
configuration and all other inputs. Retain the returned plan, metadata and verification hashes
privately. The old general bootstrap workload-boundary changeset is not this activation path.

The IAM provider can report its deprecated parent-role `inline_policy` snapshot separately from
the managed child policy. The role and canonical baseline guards accept only an empty snapshot
becoming the exact independently checked restore-only child policy, with unchanged role identity,
other values and configuration. The final exact platform removal instead binds the refreshed
prior role/policy to the reviewed deletes. This is a read-only observation: original plan/state
bytes and serial are retained, and unrelated drift still fails. Do not apply a refresh-only plan,
broaden the generic drift allowlist or fabricate a new baseline sidecar to bypass verification.
This compatibility is tested with generated fixtures; it does not assert that an actual newly
created restore role has exhibited the observation or that recovery execution has passed.

Bootstrap observations use a separate guard, without platform KMS assumptions. Only the six
retained native boundary policies' null-to-empty explicit tags and the deployment role's
computed inline-policy observation are accepted. The latter must equal the separately owned,
unchanged `aws_iam_role_policy.github_deploy`; all other role values remain exact. Duplicate,
unowned, unknown or changed observations refuse. The original pre-refresh state remains bound;
an action-free plan with these observations is not a claim of strict zero observed drift.
Dark recovery serializes explicit null Terraform inputs as `null` and restores originally absent
environment inputs by removing them, preserving a distinct originally empty value.

After this drill's exact Lambda and RDS cleanup, use the platform `Disable` transition with
`-CleanupMode CompletedDrill`, the reviewed preparation, preserved original restore-context copy
and cleanup journal. Verify role/function-version/restore absence, then disable the bootstrap
allowance. `UnusedRole` is a bounded rollback for permission setup that never reached execution,
including bootstrap-only activation; it is not a substitute for actual drill cleanup evidence.
An ambiguous or partially applied plan requires inspection and separately reviewed recovery,
not a blind retry or a fabricated successful verification receipt.

The complete current manifest is seven migration contributors, twelve schemas, 79 migrations and
96 relations. All eight current candidate-data owners are reconciled. Historical D1/D2 completed
markers retain their original version/digest and retention values, using the compiled catalog in
[candidate-deletion-restore-policy.ts](../../../backend/workflows/src/candidate-deletion-restore-policy.ts).
This catalog is provenance validation, not a renewed contribution or candidate approval.

## Build and local checks

Owner revision (2026-10-10): formal whole-row preservation and reconciled-copy proof are no longer
recovery admission gates. Replay retains transactional preflight, exact subject/operation binding,
owner deletion functions, document absence checks and terminal postconditions. Existing full-data
verification tools are optional diagnostics. See [ADR-048](../../../docs/adr/048-privacy-reconciled-development-recovery.md).

Use PowerShell 7.4 or newer and the pinned repository dependencies:

```powershell
pnpm --filter @ai-job-apply/workflows build:lambda:deletion-restore
pnpm test:deletion-restore
pnpm --filter @ai-job-apply/workflows exec vitest run src/candidate-deletion-restore-store.test.ts src/candidate-deletion-restore-contract.test.ts src/candidate-deletion-restore-lambda.test.ts
pnpm --filter @ai-job-apply/workflows typecheck
```

A local artifact is not publishable provenance. For actual execution, build twice from the exact
clean merged commit with process-local `ARTIFACT_SOURCE_SHA` set to that commit and compare
artifact/manifest/SBOM hashes. The operator requires that source, not `local`.

The real PostgreSQL test additionally needs an explicitly owned fresh loopback cluster with a
database named `d2_restore_replay_<suffix>`, plus process-local
`CANDIDATE_DELETION_RESTORE_INTEGRATION=1` and
`CANDIDATE_DELETION_RESTORE_TEST_DATABASE_URL`. Run only
`src/candidate-deletion-restore-store.integration.test.ts` through the workflow integration config.
The test never creates a cloud resource or accepts a non-loopback database. Do not share its
cluster with other migrated suites; the Jobs reader-role verifier checks cluster-wide grants.
Remove only the generated test resource, then stop Docker/WSL when no next step needs them.

## Guarded execution

For quiescent privacy recovery, use PITR `-DarkRecovery` and pass `-DarkRecovery` to every
replay action, including cleanup. The replay operator selects the separate development dark
restore context and requires the maintained PITR `Status` checks: exact-input fresh zero drift,
all application writers stopped, a protected available source and one verified isolated target.
The preparation binds this mode and all three additional recovery operator/helper files.
Legacy preparations without a mode remain steady-state only. Switching modes, stripping the
dark mode or changing context/operator bytes refuses; no live route or writer is enabled.
The separate role transition, artifact publication, explicit invocation, target restrictions and
original 30-minute replay expiry remain required. This path is locally tested tooling, not
managed privacy acceptance.

Run `pnpm --filter @ai-job-apply/workflows replay:candidate-deletions -Help` for the exact command
surface. The historical TypeScript CLI routes to this same operator; its direct-URL replay path
and obsolete per-marker loop are removed.

1. Run PITR `Start` and `Verify`, not the combined `Exercise` action, so the exact verified
   target remains available for replay. Retain the original private restore context unchanged.
2. Review the current refresh-backed zero-drift runtime plan with the restore role enabled, the
   exact context bytes, the built artifact manifest, and the compiled accepted-policy catalog.
3. Run `Prepare` with `-ExpectedAccountId`, `-StateBucket`, `-RuntimePlanPath`,
   `-ReviewedRuntimePlanSha256`, `-ReviewedRestoreContextSha256`, `-SourceSha`,
   `-ReviewedArtifactManifestSha256`, and `-AcceptedPolicyCatalogSha256`. Preparation is
   cloud-read-only and writes a user-only private packet below the environment's ignored
   `.terraform/development-candidate-deletion-replay` directory.
4. Review that packet and use its exact `-PreparationPath` and `-ReviewedPreparationSha256`
   for subsequent actions. `Create -Execute` publishes/verifies the immutable artifact and
   creates only the packet's uniquely named temporary Lambda. Its configuration expires after
   30 minutes and each invocation is bounded to 300 seconds. No automatic extension or retry.
5. Run `Inspect`. The runtime validates the complete version-bound completed-marker set,
   historical policies, decrypted locator bindings, restored owner collisions, and cloud document
   absence before any replay. Both quarantine and normalized document namespaces are checked,
   including the parser-write/database-acknowledgement gap. No document body is downloaded.
6. Review the resulting aggregate response. Run `Replay -Execute` with its exact
   `-InspectionPath` and `-ReviewedInspectionReceiptSha256`. The runtime recomputes the
   inspection, rechecks the cloud authority, and transactionally revalidates the whole restored
   preflight before the first database write. It calls the existing seven owner deletion
   boundaries only against that copy.
7. Run `Cleanup -Execute`. First it disables the temporary Lambda's concurrency and returns
   an earliest deletion time and checksum-bound disabled receipt. After the full in-flight
   timeout window, repeat cleanup with that receipt's `-ReviewedCleanupDisabledSha256`.
   This removes only the exact tagged Lambda. The immutable artifact remains intentionally
   retained; it contains code, not candidate data.
8. Run the maintained PITR `Cleanup` separately to remove the exact restored database and
   its temporary backups/context. Confirm source health, zero drift, no remaining temporary
   compute, and unchanged live candidate/document/ledger state. Turn the dedicated restore
   role allowances off only through a separately reviewed cleanup plan after executor cleanup.

## Failure handling and aggregate meaning

### Read-only historical completion diagnosis

For a retained `CompletionCollision`, `DiagnoseCompletion` uses the same fresh preparation and
version-qualified executor. It is a separate diagnostic, not a successful `Inspect` or permission
to run `Replay`. It requires one exact completed marker, verifies its body and version-bound
metadata, and reads the matching identity, request, operation, ledger and bounded dispatch set in
one read-only repeatable-read transaction. No document, Auth0, SQL or cloud-object write runs.

The fixed response distinguishes refusal, consistency and a corroborated persisted candidate.
Only agreeing persisted completion timestamps can produce a candidate; a later attempt clock
cannot. Dispatch timestamps preserve PostgreSQL microseconds and report acknowledged/unclaimed
bindings only. They do not prove that old executions, retries or delayed writers have retired.
The response contains comparisons, opaque digests and bounded times, never rows or locators.

The operator journals this action even when its response is ambiguous. Keep the original packet
and observe the full 330-second cleanup drain; never renew it or bypass the ordinary preflight.
Any separately approved exact-version tag correction remains outside this executor and its IAM
role. It needs authenticated diagnostic provenance, independent writer-exclusion evidence and
unchanged version/body/metadata/retention/tag preconditions. Preserve the complete preimage and
reserve a stable durable one-attempt journal before writing; uncertainty permits readback only,
not another write or rollback. A candidate digest alone grants no authority. Afterwards use the
unchanged `Inspect` and `Replay` path on the same verified restore.

### Separately authorized recovery of a proven pre-dispatch refusal

The ordinary repair entrypoint never reopens its original reservation. A separate
`createHistoricalCompletionPreDispatchRecovery` entrypoint is limited to a finished original
execution whose authenticated result and reviewed execution code establish that no write was
dispatched. Unchanged tags, a zero-shaped JSON field, a file hash, or an expired diagnostic alone
do not establish that fact. The composition must also authenticate explicit recovery authority.

Preserve the original journal bytes and validate its decision against the original diagnostic.
Obtain a fresh authenticated diagnostic for the same version, complete immutable preimage,
original tags and intended correction; only source/evidence provenance may renew. The recovery
uses one fixed, protected `<scope>.pre-dispatch-recovery.json` companion beside `<scope>.json`.
It must be exclusively created, durably flushed and read back before constructing the write
client. Preserve and recheck the original file, require two fresh unchanged writer-exclusion
passes and exact object preconditions, and retain the existing single-send deadline and endpoint,
owner, version and checksum bindings.

An existing, partial, conflicting or uncertain companion permits no further write. There is no
recovery-of-recovery, alternate namespace, journal reset or automatic retry. An ambiguous write
still permits only exact intended-state readback. This local recovery path adds no executor IAM
permission and does not bypass ordinary `Inspect`, `Replay` or cleanup on the same verified PITR.

### Ordinary inspection and replay

A malformed or incomplete marker, unexpected version/delete marker, unknown historical policy,
locator/owner collision, nonempty document namespace, changed inspection, expired configuration,
or failed owner boundary stops the operation. Retained cloud objects, Object Lock retention,
completion tags, Auth0 identities, export objects, and production resources are never mutated.

An invocation failure or lost response may be ambiguous after restored SQL committed. Keep the
target dark; inspect again and review recovery. The same preparation cannot blindly retry a
started replay, renew its expiry, or silently create a replacement executor.

Responses conform to [the workflow-owned internal schema](../../../backend/workflows/schemas/candidate-deletion-restore.v1.schema.json).
They contain only aggregate counts, status, run/source/configuration digests, and bounded times;
no candidate IDs, object keys, database URLs, or secret values leave the executor.
`documentKeysChecked` counts known reference keys covered by the stronger namespace absence
checks; `documentVersionsObserved` must be zero. Reconciled, physically absent, and already
reconciled tombstones are distinct counts. An empty valid inspection is not positive deletion
acceptance. Do not relabel this response as the historical D1 acceptance receipt or assert cleanup
until the separate temporary-Lambda and PITR cleanup steps actually succeed.

Complete normal schema/integrity, workflow, alarm, RTO/RPO and accountable recovery acceptance
before any traffic is considered. Backup-window expiry still requires actual recoverability and
manual/cross-account backup inventory evidence; elapsed time alone is insufficient.
