# Original native resume terminal recovery

Use for `native_resume_terminal` messages in the original release's encrypted observation queue
or its durable failure/timeout/terminal-delivery alarms. This is an operator recovery procedure,
not an automatic replay consumer or authority to mutate cloud resources. Complete a managed
synthetic drill before enabling candidate traffic. D1/D3 acceptance is not established by this file.

## Identify and contain

1. Verify account, region, original task revision, numeric durable version and original named
   execution against the owning request/launch ledger. Queue metadata is a hint, never proof.
   Read current execution metadata with `IncludeExecutionData=false`. Confirm terminal status;
   missing metadata, expired checkpoints or a still-running execution remain unresolved.
2. Preserve original execution checkpoints, versions, roles, DNS configuration and task identity.
   Checkpoints currently retain seven days; queue messages retain fourteen. Investigate before
   the shorter retention expires. Keep access restricted and avoid copying candidate identifiers,
   input payloads or raw checkpoints into chat, general logs or tickets.
3. Pause new intake through its reviewed scheduling controls if failures are systemic. Disabling
   creation or changing an environment variable publishes a new version; it does not switch off
   old numeric executions. Keep original cleanup and terminal observation available. Do not
   start another execution, relaunch the task or regenerate the document to recover this failure.

## Inspect original effects

Read only the original execution's protected scalar route checkpoints through an authorized
operations session: `resume-route.intent.v1`, `resume-route.create.v1`, `resume-route.attach.v1`,
`resume-route.remove.v1`, and `native-resume.route-outcome.v1` when present. Match allocation,
zone, host, IP, original expiry and change IDs to that retained release. Missing/mismatched
records require escalation, not guessed reconstruction from the current task address.

- A checkpointed skipped creation means this execution sent no DNS create. Investigate the
  incomplete preparation separately; do not claim successful attachment.
- If the original delete change ID is retained, observe that exact change until INSYNC and
  inspect the exact record for absence. Both are required to record authoritative DNS removal.
- If the exact original record is positively present, original expiry or positively confirmed
  retirement makes it eligible for cleanup. An authorized operator may issue one exact DELETE
  using the original A record, TTL 30 and IP after confirming no active original writer and
  exclusive recovery ownership. Retain the returned change ID in restricted incident evidence,
  then verify INSYNC and absence. Do not UPSERT, delete a conflicting record, reuse the allocation
  name, or retry an uncertain mutation blindly. This manual action is not executed by this task.
- If creation/deletion acknowledgement is unknown and the record is absent, absence alone does
  not establish ordering or propagation. Preserve the unresolved status and obtain original
  service/change evidence; do not manufacture a receipt or declare cleanup from a timeout.
- Attachment acknowledgement can be lost after its transaction commits. Read the owning
  original packet/reference binding. Do not repeat admission against a changed preparation
  revision or infer attachment failure solely from the workflow error.

DNS removal does not certify task death, external cache expiry, content purge or all-copy deletion.
Original task retirement still requires the trusted ECS observer. Candidate/privacy actions stay
with their owning services. A terminal workflow alone authorizes none of those conclusions.

## Close and retain

Record only verified scalar outcomes and evidence references, including unresolved portions.
Remove the notice only after accountable disposition; message deletion is not recovery. Check
for duplicate notices for the same original execution without treating duplicates as new work.
Retain original releases until every owned task/route/attachment is accounted for. If execution
history is unavailable or mutation ordering cannot be proven, keep the incident unresolved and
block release retirement. The optional scheduled receipt reconciliation below can recover a
missed failure notice; it does not perform recovery actions or establish cleanup.

## Bounded private receipt inspection

After Applications migration 0011, the new observer version can expose `inspect_executions` with
`execution_inspection_enabled=true`. Its exact retained workflow allowlist is configured through
`retained_workflow_versions` plus the current original durable version. Invoke only the approved
numeric observer version under the existing private operations authority with this scalar request:

```json
{"schemaVersion":1,"action":"inspect_executions","workflowArn":"<retained numeric original workflow ARN>","afterEventId":null}
```

The response contains at most two scalar receipt results. Follow `nextAfterEventId` through the
whole version's inventory; start subsequent passes at null so late receipts are revisited. This
is an explicit operator read, not an enabled scheduled sweep. Keep identifiers in restricted
operations context. Unknown receipt/status is not failed work, no-source is not an execution,
and SUCCEEDED is not independent proof of route cleanup. Existing role/boundary/endpoint grants
must all be released and verified before relying on managed results.

## Scheduled receipt reconciliation

Apply Applications migration 0012 before deploying the new observer. Enable original execution
inspection and then `execution_reconciliation_enabled` for that retained preparation release.
Both switches default off. The exact original numeric observer receives the strict private
`reconcile_executions` action every minute. Retain the original workflow-version allowlist,
private SQS endpoint, exact queue permissions and encryption permissions with the release.

Each invocation claims at most two published original execution receipts. Claims rotate by
least-recent check, with a five-minute retry lease and token fencing for concurrent observers.
Metadata reads exclude execution data. Positive SUCCEEDED observations stop scanning; confirmed
FAILED, TIMED_OUT or STOPPED observations are persisted before sending the existing scalar
`native_resume_terminal` envelope to the original encrypted queue. Only an acknowledged send
records notification completion. A lost acknowledgement can duplicate a notice. A cached positive
failure survives later checkpoint expiry, so delivery retries do not need another AWS read.

Unknown metadata, inaccessible or expired history, missing dispatch acknowledgement and identity
mismatches remain unresolved. This mechanism does not launch tasks, replay executions, settle
application state, remove DNS, or certify deletion. Queue messages remain operator work.

The bound is two observations per scheduled minute, with repeat checks consuming capacity.
Before activation, drill missed terminal delivery and lost queue acknowledgement with synthetic
managed executions and prove backlog drains within the seven-day execution-history retention.
Watch original observer errors, schedule delivery/DLQ failures and existing queue alarms. A
sustained backlog or unresolved history requires operator disposition; do not infer success from
an empty queue. Local database tests and simulated AWS responses do not replace that drill.
