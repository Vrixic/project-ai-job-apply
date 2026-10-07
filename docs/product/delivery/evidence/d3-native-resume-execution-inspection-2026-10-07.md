# D3 original resume execution inspection - 2026-10-07

D3-064/D3-079 remain In progress. The existing private task observer now has an independently
gated `inspect_executions` action, backed by Applications' original receipts and metadata-only
GetDurableExecution. No new Lambda/artifact family, public API or SQL migration is introduced.

The request is a closed object with `schemaVersion: 1`, `action: "inspect_executions"`,
`workflowArn` and nullable `afterEventId`. The configured allowlist pins one original function's
current and retained numeric versions (at most eight). Environment drift refuses before effects.
Each call reads at most two original SQL receipts, then performs at most two one-attempt AWS
reads with ten-second abort deadlines. It verifies exact ARN/name/function/version, timestamps,
known status and absence of input/result/error data. Missing or malformed responses remain
`unknown`; no-source receipts remain `no_resume` without AWS calls. Gate withdrawal prevents
returning partially observed results. Overlapping inspection calls refuse.

The response contains only schema version, original event/execution identifiers, projected status
and a nullable keyset cursor. `SUCCEEDED` describes AWS execution only, not DNS removal or all-copy
purge; inspect original checkpoints/owner state for those conclusions. Null launch receipts remain
unknown. Cycle complete scans so late acknowledgements behind a prior cursor are revisited.
No status settlement, resume generation, task launch/stop, DNS mutation or replacement invocation
is added. The reader alone is not automated missed-event reconciliation.

## Runtime and permissions

Terraform `execution_inspection_enabled` defaults false and requires the observer runtime, but
not new-launch activation. `retained_workflow_versions` adds at most seven numeric versions to
the current original version. Both environments wire these inputs. The observer's role allows
only GetDurableExecution for those exact version subresources; its original-principal bootstrap
ceiling and private Lambda endpoint policy allow metadata access for the original function.
Existing Invoke/RunTask/StopTask denial remains. No broad shared-workload grant is added.
Migrate Applications 0011 before enabling this new read. Retain original versions/IAM until drain.

## Local verification

- Documents and Workflows TypeScript builds pass; focused Biome checks pass.
- 41 observer/inspection tests pass, including malformed/foreign AWS metadata, content-bearing
  responses, defaults, retained-version refusal, gate withdrawal and overlapping inspection.
- All 65 real PostgreSQL resume cases pass. The connected case uses the compiled observer runtime,
  actual original receipt query after quarantine and simulated exact AWS metadata.
- 20 preparation, eight bootstrap and three endpoint mocked Terraform cases pass (31 total).
  Both environment configurations validate. An endpoint assertion was moved from the empty-input
  fixture to its configured-release case; a test-only TypeScript annotation was corrected.
- The source-bound observer artifact check follows at the clean committed checkpoint below.

No live AWS metadata, effective IAM, endpoint reachability, publication, deployment or activation
is claimed. No full verifier or fresh dependency audit; prior dependency findings remain open.
The disposable SQL container is removed and Docker/WSL stopped; PC stays on. CI/CD deferred.

## Remaining launch gates

Persisted recovery settlement, automatic repeated scans, unknown launch-ACK reconciliation and
DNS-effect recovery still require work or an accepted, drilled operator procedure. Hostname/TLS,
managed release and client acceptance remain open. ADR-040 is Proposed; D1/D3 are incomplete.
