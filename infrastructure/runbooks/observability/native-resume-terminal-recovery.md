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
block release retirement. Automated missed-event reconciliation remains a separate launch gap.
