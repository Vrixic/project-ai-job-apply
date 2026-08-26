# Development document-processing direct-dark acceptance

Use this runbook to prove the deployed document intake, parser, proposal, review, contradiction,
rollback, and cleanup path with generated synthetic data while every production ingestion trigger
remains disabled. Its separate `ServiceDetection` action proves only the already-active exact
GuardDuty protection plan's managed scan/tag behavior for one generated clean object. Neither path
authorizes or proves EventBridge delivery, SQS delivery, the Lambda event-source mapping, the
processor/parser trigger path, or the timeout reconciler. Activation remains a separate human
decision under [ADR-023](../../../docs/adr/023-isolate-untrusted-document-parsing.md).
The direct gateway calls fabricate the exact context an already successful JWT authorizer would
provide; they do not traverse API Gateway and do not prove route selection, JWT/JWKS validation, or
authorizer enforcement.

The operator is
[`scripts/operate-development-document-processing-acceptance.ps1`](../../../scripts/operate-development-document-processing-acceptance.ps1).
It accepts no document bytes, filenames, object identifiers, identity subjects, routes, commands,
roles, or network destinations. The only documents are produced by the reviewed zero-dependency
[`development-document-processing-fixtures.mjs`](../../../scripts/lib/development-document-processing-fixtures.mjs).

## Required inputs

- A clean `main` exactly matching `origin/main`. `-SourceSha` identifies the deployed application
  revision bound by the migration-image receipt. It may be an ancestor of `main` only when every
  later change is documentation or this exact document-acceptance operator/test/runbook packet.
  The operator SHA and canonical allowed-delta SHA-256 are bound separately into the execution
  plan and receipt; application or infrastructure changes remain fail-closed.
  `RecoverCleanup` and `Verify` may use a later clean reviewed operator when the execution
  operator is its ancestor. Their canonical recovery delta includes only this exact operator
  packet and documentation, rejects ambiguous changes within that packet, and separately rejects
  any change to the operator guards or fixture generator. Unrelated application/infrastructure
  commits may coexist on `main` because recovery invokes only the already reviewed deployed
  runtime and revalidates its exact live identity before every mutation. Fresh planning and
  execution retain the stricter whole-tree application/infrastructure refusal.
- Recovery and read-only verification may tolerate later Terraform state serials only when the
  state lineage, immutable migration image, and complete reviewed Lambda/task/bucket/trigger
  runtime identity are unchanged. The operator binds every subsequent mutation and its closing
  check to that current serial. Fresh execution still requires the exact reviewed serial.
- A temporary development IAM Identity Center session in the exact expected AWS account and
  `us-east-2`.
- The encrypted, versioned development Terraform state bucket.
- The exact verified version-2 migration-image publication receipt and its reviewed SHA-256. The
  receipt must bind the source SHA to the scanned immutable `ai-job-apply/migration` platform
  digest.
- Terraform 1.9.8, AWS CLI v2, Node.js, pnpm, PowerShell 7, and Windows PowerShell 5.1 for the
  focused local gate.

Never publish an execution plan, receipt, recovery descriptor, task override, or CloudWatch payload.
They contain generated-synthetic operational identifiers and remain below the ignored development
`.terraform` directory or encrypted state bucket.

## Local gate

Run the focused suite in both supported shells before planning:

```powershell
pwsh -NoProfile -File scripts/tests/development-document-processing-acceptance-operator.tests.ps1
powershell.exe -NoProfile -File scripts/tests/development-document-processing-acceptance-operator.tests.ps1
```

The suite proves the exact public parameter surface, six fixed ECS environment entries, deployed
issuer binding, distinct normal and recovery cleanup tokens, exact phase counts, duplicate event
replay, recovery descriptor rejection, idempotent exact-version deletion semantics, deterministic
four-entry fixture generation, production parsing of the clean PDF and DOCX, invalid-PDF rejection,
and harmless malware-disposition fixture structure. It performs no AWS mutation.

The same suite also builds the production parser and generates the fixed 43-case adversarial
PDF/DOCX corpus twice. It requires byte-identical case SHA-256 values, the exact bounded rejection
reason for every case, and rejection of any payload-bearing aggregate.

## Deployed adversarial parser corpus

This is a separate generated-only gate. `CorpusPlan` builds the existing adversarial generator and
writes a review packet below the ignored development `.terraform` directory. The packet binds the
clean deployed source, Terraform lineage/serial, exact processor and parser numeric versions and
code digests, semantic parser version `resume-parser-v1`, all-dark trigger state, 43 case digests,
and the canonical corpus SHA-256.

```powershell
pwsh -NoProfile -File scripts/operate-development-document-processing-acceptance.ps1 `
  -Action CorpusPlan `
  -ExpectedAccountId <account-id> -StateBucket <state-bucket> -SourceSha <merged-sha> `
  -MigrationReceiptPath <verified-image-receipt> `
  -ReviewedMigrationReceiptSha256 <receipt-sha256>

pwsh -NoProfile -File scripts/operate-development-document-processing-acceptance.ps1 `
  -Action CorpusExecute `
  -ExpectedAccountId <account-id> -StateBucket <state-bucket> -SourceSha <merged-sha> `
  -FixtureSetSha256 <reviewed-corpus-sha256> `
  -MigrationReceiptPath <verified-image-receipt> `
  -ReviewedMigrationReceiptSha256 <receipt-sha256> `
  -ExecutionPlanPath <reviewed-corpus-plan> `
  -ReviewedExecutionPlanSha256 <corpus-plan-sha256>
```

`CorpusExecute` revalidates the full reviewed runtime before each mutation, uploads only the 43
descriptor-bound generated versions with exact KMS, checksum, media-type, size, and metadata
readback, and writes the fixed synthetic clean tag. It directly invokes the exact numeric dark
processor version; that version invokes only its exact numeric parser pin. The mapping, GuardDuty
rule, reconciler, provider inputs, and real-resume path remain off. The special processor request
branches before database resolution, so the gate creates no rows. Success requires 43 exact
rejections and the descriptor-derived reason-code histogram; retained evidence contains no bytes,
text, filenames, document IDs, keys, versions, ARNs, or candidate data.

The operator always removes every version and delete marker at the exact generated quarantine key
and throughout each generated document's normalized namespace, then removes the local corpus
directory and proves absence. If execution is interrupted or cleanup fails, do not rerun it. Review
the checkpoint receipt and use `CorpusRecoverCleanup`; recovery performs cleanup only and never
invokes the processor or claims acceptance. A verified receipt may be rechecked with
`CorpusVerify`, which revalidates the dark runtime and aggregate without invoking either Lambda.

```powershell
# Replace CorpusRecoverCleanup with CorpusVerify for an already verified receipt.
pwsh -NoProfile -File scripts/operate-development-document-processing-acceptance.ps1 `
  -Action CorpusRecoverCleanup `
  -ExpectedAccountId <account-id> -StateBucket <state-bucket> -SourceSha <merged-sha> `
  -FixtureSetSha256 <reviewed-corpus-sha256> `
  -MigrationReceiptPath <verified-image-receipt> `
  -ReviewedMigrationReceiptSha256 <receipt-sha256> `
  -ExecutionPlanPath <reviewed-corpus-plan> `
  -ReviewedExecutionPlanSha256 <corpus-plan-sha256> `
  -ReceiptPath <reviewed-corpus-receipt> `
  -ReviewedReceiptSha256 <corpus-receipt-sha256>
```

This gate does not prove trigger delivery, GuardDuty service detection, database processing,
provider ingestion, alert delivery, API Gateway/JWT enforcement, real candidate data, or ADR-023
acceptance.

## 1. Confirm the dark boundary

```powershell
pwsh -NoProfile -File scripts/operate-development-document-processing-acceptance.ps1 `
  -Action Status `
  -ExpectedAccountId <account-id> `
  -StateBucket <state-bucket>
```

Continue only when the mapping is `Disabled`, the scan-result rule is `DISABLED`, the reconciler is
`DISABLED`, and `ActivationAuthorized` is false. `PlanExecution`, `Execute`, `ServiceDetection`,
`ObjectRecovery`,
`RecoverCleanup`, and `Verify` repeat this live guard. No operator action can enable a trigger.

## 2. Produce the review-only execution plan

```powershell
pwsh -NoProfile -File scripts/operate-development-document-processing-acceptance.ps1 `
  -Action PlanExecution `
  -ExpectedAccountId <account-id> `
  -StateBucket <state-bucket> `
  -SourceSha <merged-sha> `
  -MigrationReceiptPath <verified-image-receipt> `
  -ReviewedMigrationReceiptSha256 <receipt-sha256>
```

Review the returned execution-plan SHA-256 and fixture-set SHA-256. The plan must contain exactly
four deterministic manifest roles (`clean-pdf`, `clean-docx`, `invalid-pdf`, `malware-test`) and
eight requests: the seven fixed acceptance actions plus one separately tokenized
`recovery-cleanup` request. Every task has exactly these six environment variables:

- `DOCUMENT_PROCESSING_ACCEPTANCE_CONFIRM=generated-synthetic-only`
- `DOCUMENT_PROCESSING_ACCEPTANCE_ACTION`, fixed per reviewed request
- `DOCUMENT_PROCESSING_ACCEPTANCE_RUN_ID`, a generated lowercase UUIDv4
- `DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_SET_SHA256`
- `DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_MANIFEST`, the canonical four-entry JSON manifest
- `DOCUMENT_PROCESSING_ACCEPTANCE_ISSUER`, bound to the exact deployed gateway issuer

The task command is only `documents/dist/src/run-document-processing-acceptance.js`. The ECS
request omits `propagateTags`, which is the API's no-propagation representation; recovery of an
older reviewed plan may normalize only the rejected historical literal `NONE` to omission and use
its deterministic `-v2` idempotency-token namespace because ECS binds the failed payload to the
first token. Recovery permits at most three deterministic task-start attempts inside that namespace
when ECS returns `TaskFailedToStart` with `ResourceInitializationError`; application/container
failures are never retried. Do not
edit the plan or fixture files after review. The plan also checksum-binds the exact numeric gateway
and
processor versions behind their unweighted aliases, their qualified ARNs, code hashes, alias and
function revision IDs, and the processor's exact Terraform-bound parser numeric version, qualified
ARN, code hash, and function revision ID. Execution and verification reject any alias routing,
retargeting, parser substitution, or code-identity change. Execution re-reads the full reviewed
runtime and Terraform lineage/serial immediately before every Lambda, ECS, presigned upload, tag,
durable claim/descriptor, or exact-version deletion mutation.

## 3. Execute once

Execute within the plan's 15-minute review window:

```powershell
pwsh -NoProfile -File scripts/operate-development-document-processing-acceptance.ps1 `
  -Action Execute `
  -ExpectedAccountId <account-id> `
  -StateBucket <state-bucket> `
  -SourceSha <merged-sha> `
  -FixtureSetSha256 <reviewed-fixture-sha256> `
  -MigrationReceiptPath <verified-image-receipt> `
  -ReviewedMigrationReceiptSha256 <receipt-sha256> `
  -ExecutionPlanPath <reviewed-execution-plan> `
  -ReviewedExecutionPlanSha256 <execution-plan-sha256>
```

The operator creates an encrypted, versioned, one-use durable claim before mutation. It then:

1. Proves no exact synthetic issuer/subject exists.
2. Directly invokes the deployed gateway alias with an exact API Gateway v2 authorizer context and
   registers the clean PDF and DOCX through `POST /v1/resumes/uploads`.
3. Uploads only through each returned bounded presigned POST, then verifies exact S3 version,
   content length, media type, KMS encryption, metadata, checksum when returned, and one-version
   history. Before sending bytes it requires the exact reviewed bucket's regional HTTPS host, root
   path, exact known AWS signer field set, and exact `quarantine/<returned-document-id>/source`
   form key; it rejects any preexisting `file` field and disables HTTP redirects.
4. Writes and reads back the exact versioned synthetic scan tag, then synchronously invokes the
   deployed processor alias with the exact `document.scan-result.v1` body in a one-record SQS
   envelope. It repeats each of the four initial events with the exact same byte-equivalent domain
   body and SQS envelope and
   proves receipt/disposition counts do not grow.
5. Proves two parsed documents, three proposed facts, three versions, and three evidence rows.
6. Uses the deployed gateway to confirm the generated email unchanged, edit `TypeScript` to
   `TypeScript (reviewed synthetic)` and confirm it, and reject `PostgreSQL`. It then proves three
   facts, six versions, five evidence rows, two confirmed facts, and one rejected fact.
7. Registers the invalid PDF and harmless malware-disposition PDF, proves the exact terminal
   outcomes, then submits one contradictory result for the clean PDF. It proves exactly one held
   document and one invalidated email fact, with seven versions and six evidence rows.
8. Proves transaction rollback, then runs the independently fact-safe cleanup action.
9. After database cleanup succeeds, deletes only the four descriptor-bound source versions and the
   two derived normalized versions. Every delete is followed by a zero-history proof for that exact
   key. No prefix, latest-version, or unversioned delete is permitted.

The receipt checkpoints database cleanup and object cleanup separately. Successful output is a
privacy-safe aggregate; it contains no candidate values, filenames, document IDs, object keys, or
identity subjects.

## 4. Recovery

If execution returns `cleanup-required`, do not rerun `Execute` and do not manually delete rows or
objects. Review the receipt SHA-256, then run exactly one bounded recovery:

```powershell
pwsh -NoProfile -File scripts/operate-development-document-processing-acceptance.ps1 `
  -Action RecoverCleanup `
  -ExpectedAccountId <account-id> `
  -StateBucket <state-bucket> `
  -SourceSha <merged-sha> `
  -FixtureSetSha256 <reviewed-fixture-sha256> `
  -MigrationReceiptPath <verified-image-receipt> `
  -ReviewedMigrationReceiptSha256 <receipt-sha256> `
  -ExecutionPlanPath <reviewed-execution-plan> `
  -ReviewedExecutionPlanSha256 <execution-plan-sha256> `
  -ReceiptPath <cleanup-required-receipt> `
  -ReviewedReceiptSha256 <cleanup-required-receipt-sha256>
```

Recovery authenticates the exact encrypted descriptor before reading any object key. It rejects
unknown roles, duplicate roles or IDs, non-derived keys, manifest mismatches, extra versions, and
delete markers. If database cleanup already succeeded, recovery skips the server cleanup task. If
an exact object version was already removed, zero history is accepted and recovery continues with
the remaining descriptor-bound versions. Recovery never makes an acceptance claim.

## 5. Prove GuardDuty service detection without trigger activation

Use a fresh reviewed execution plan that has not been claimed by `Execute` or another
`ServiceDetection` run:

```powershell
pwsh -NoProfile -File scripts/operate-development-document-processing-acceptance.ps1 `
  -Action ServiceDetection `
  -ExpectedAccountId <account-id> `
  -StateBucket <state-bucket> `
  -SourceSha <merged-sha> `
  -FixtureSetSha256 <reviewed-fixture-sha256> `
  -MigrationReceiptPath <verified-image-receipt> `
  -ReviewedMigrationReceiptSha256 <receipt-sha256> `
  -ExecutionPlanPath <reviewed-execution-plan> `
  -ReviewedExecutionPlanSha256 <execution-plan-sha256>
```

The action revalidates the exact active malware-protection plan, protected bucket and
`quarantine/` prefix, and enabled managed tagging. It registers and uploads only the reviewed clean
PDF, then polls only that exact object version for GuardDuty's managed
`GuardDutyMalwareScanStatus=NO_THREATS_FOUND` tag for at most fifteen minutes. It never writes a scan
tag itself and never invokes the processor or parser. Whether the scan succeeds or fails, the
operator runs the existing owner-safe database cleanup and removes only the descriptor-bound object
version. An interrupted cleanup remains recoverable through `RecoverCleanup` and the checksum-bound
receipt.

Accept only `guardduty-service-detection-verified-and-cleaned`, one scanned object, zero persistent
rows, exact object removal, and `TriggerActivation=false`. This proves GuardDuty service scanning
and managed tagging only. EventBridge delivery, SQS delivery, event-source mapping, processor/parser
activation, API Gateway/JWT enforcement, and real resumes remain unproved and unauthorized.

## 6. Prove exact versioned-object recovery

Use another fresh reviewed execution plan and the same exact inputs as service detection, changing
only the action:

```powershell
pwsh -NoProfile -File scripts/operate-development-document-processing-acceptance.ps1 `
  -Action ObjectRecovery `
  -ExpectedAccountId <account-id> `
  -StateBucket <state-bucket> `
  -SourceSha <merged-sha> `
  -FixtureSetSha256 <reviewed-fixture-sha256> `
  -MigrationReceiptPath <verified-image-receipt> `
  -ReviewedMigrationReceiptSha256 <receipt-sha256> `
  -ExecutionPlanPath <reviewed-execution-plan> `
  -ReviewedExecutionPlanSha256 <execution-plan-sha256>
```

The action first requires GuardDuty's managed clean tag on one generated PDF version. It then
creates one exact delete marker, proves the descriptor-bound prior version remains, reads that exact
version and verifies its SHA-256, writes a new checksum/KMS/metadata-bound version, and requires a
fresh GuardDuty `NO_THREATS_FOUND` result for the restored version. It removes only the generated
delete marker and superseded version, proves one current restored version, and finally uses the
normal owner-safe database and exact-version cleanup to reach zero rows and zero object history.

Accept only `versioned-object-recovery-verified-and-cleaned`, two managed clean scans, all three
recovery booleans true, zero persistent rows, exact object removal, and
`TriggerActivation=false`. A partial recovery is reconciled back to one descriptor-bound version
before normal cleanup; otherwise the checksum-bound receipt remains for `RecoverCleanup`. This
proves same-region versioned-object recovery for generated data only, not cross-region replication,
real candidate recovery, EventBridge/SQS delivery, processor/parser activation, or an RTO/RPO.

## 7. Read-only verification and retained evidence

```powershell
pwsh -NoProfile -File scripts/operate-development-document-processing-acceptance.ps1 `
  -Action Verify `
  -ExpectedAccountId <account-id> `
  -StateBucket <state-bucket> `
  -SourceSha <merged-sha> `
  -FixtureSetSha256 <reviewed-fixture-sha256> `
  -MigrationReceiptPath <verified-image-receipt> `
  -ReviewedMigrationReceiptSha256 <receipt-sha256> `
  -ExecutionPlanPath <reviewed-execution-plan> `
  -ReviewedExecutionPlanSha256 <execution-plan-sha256> `
  -ReceiptPath <verified-receipt> `
  -ReviewedReceiptSha256 <verified-receipt-sha256>
```

Verification requires zero running/pending migration-family tasks; three empty document queues;
the exact eight document alarms actioned to the operational topic and settled to `OK` within the
bounded retry window; dark mapping/rules;
no generated run/event/message identity, subject, email, fact value, fixture body or filename,
fixture/object digest, document ID, object key, or source/normalized version ID in the bounded
application-log interval after a two-minute event window and ingestion grace; exactly one
value-free `document_processing_security_contradiction` log event matching the Terraform metric
filter input; and unchanged Terraform lineage and serial. The final alarm check occurs only after
the log-ingestion grace. It proves eventual health, not an alarm transition. The operator
deliberately makes no Terraform zero-drift claim because
it does not accept or reconstruct the full reviewed live variable set. Retain the separately reviewed
deployment Apply verification and its checksum-bound zero-drift baseline for that claim.

Retain only checksums and privacy-safe aggregate fields in delivery evidence. For direct-dark
`Execute`, state explicitly that the run used generated synthetic data and direct Lambda
invocations, kept all triggers disabled, and did not prove GuardDuty service scanning. For
`ServiceDetection` or `ObjectRecovery`, retain its separate checksum and aggregate result and do not
infer any trigger delivery. None of these actions proves EventBridge/SQS delivery, event-source mapping, reconciler behavior,
API Gateway routing, JWT/JWKS validation, authorizer enforcement, a generated alarm transition, or
an independently reconstructed Terraform
zero-drift plan, real candidate
resumes, staging, production, scale, or ADR-023 acceptance.
