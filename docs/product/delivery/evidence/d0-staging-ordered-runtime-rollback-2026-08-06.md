# D0-016 staging ordered runtime rollback — 2026-08-06

- Environment: isolated synthetic staging
- Region: `us-east-2`
- Exact deployed source: `63a8c88d9800a9b06b6dcf546bda14de564a66f6`
- Result: rollback, direct-alias conformance, and the bounded one-record drain passed; restoration remains open

## Ordered rollback

A fresh refresh-backed runtime baseline passed with zero drift, zero legacy or durable work, empty
queues and DLQs, enabled replacement triggers, idle ECS services, and the accepted Lambda/JWT API
boundary. The product owner separately authorized both ordered rollback checksums.

The first exact apply completed zero creates, six bounded route/gateway/trigger updates, two public
health-route deletes, zero replacements, and no ECS-capacity or persistent-data change. Post-apply
verification proved the default route used retained ECS, dispatch returned to Temporal, all
replacement triggers were disabled, ECS remained `0/0/0`, and the Lambda integration remained
present but unreferenced with zero drift.

The second exact apply deleted only that unreferenced integration. Complete dark verification
passed with no route, trigger, service-capacity, queue, database, or other persistent-resource
change.

## Direct-alias conformance

The deployed no-write Lambda boundary matrix passed all 15 expected status cases:

`200, 401, 401, 401, 401, 403, 404, 404, 404, 400, 400, 400, 415, 400, 413`

It reported no public-traffic change and no persistent application writes. The loopback bridge
smoke passed `200/200/401`. The product owner then completed the real two-account browser sequence:
account A saved a harmless synthetic preference through the immutable staging alias; account B
received only the non-disclosing result:

`Cross-user isolation passed: this account could not read the first account’s operation.`

The repeated post-browser 15-case matrix also passed. No token, provider subject, email, preference
body, operation identifier, account identifier, endpoint, credential, secret, or raw log is retained
in this record.

## Bounded drain correction

The manual dark save correctly produced one untouched Temporal-targeted outbox record with zero
attempts while ECS and triggers remained disabled. Restoration refused to proceed across that
nonterminal boundary. The existing drain operator then exposed an overly narrow historical guard:
it accepted only the earlier three-record batch.

The source correction preserves every existing safety control while accepting an exact reviewed
nonempty batch of at most 100 untouched synthetic rows. Planning binds the observed count, zero
attempts, ordered identifier digest, clean merged source, immutable worker, account boundary,
runtime topology, empty queues, alarms, and zero open Temporal workflows. Execution remains a
separately checksum-authorized one-task transition and must finish at zero pending work. Parser,
help-contract, infrastructure-policy, and whitespace validation passed before merge.

## One-record drain and interrupted-command recovery

From exact merged source `bc1f94bf734b30653aad3195025b978170ac98b3`, the guarded planner
observed exactly one untouched record, zero attempts, zero running Temporal workflows, the accepted
pre-cutover dark topology, and one worker task on execution. The product owner authorized exact
plan checksum `356432fe561ccc5b9a0577e0911fd2d14fd65e7d45434b4ba1664086d08ed475`.

The authorized command host reached its ten-minute limit before returning the operator's final
summary. The documented checksum-bound cleanup did not start another worker and found no reviewed
task left to stop. It proved zero remaining outbox records, the empty ordered-record digest, zero
running Temporal workflows, and removed the stale ignored drain context. A separate read-only
aggregate check found exactly one owned stopped task, one clean worker-startup record, and zero
error-level worker records. No raw event, operation, task, workflow, account, endpoint, token,
secret, or candidate value is retained here.

The now-empty batch cannot be replanned. Restoration preflight then exposed a provenance deadlock:
the rollback context correctly retained the pre-rollback runtime baseline commit, but the safe
generalized drain necessarily merged afterward. A source-only correction adds an explicit context
continuation gate. It requires the retained baseline source to remain an ancestor of current clean
`main`, reproves current dark zero drift and zero legacy/serverless work, preserves the historical
baseline identity, and updates only the ignored context's validated operator commit. Restoration
verification will adopt a newly generated current-commit runtime baseline instead of relabeling the
historical plan. No AWS mutation is performed by that correction.

The first exact-main continuation attempt failed before AWS verification or context mutation. Its
Windows Git process removed the `^{commit}` peel suffix used by the source-object precheck, so the
existing commit was rejected even though the separate ancestry check passed. The portable
correction requires `git cat-file -t <sha>` to return exactly `commit` and retains the independent
ancestor gate. Parser, policy, and negative provenance checks cover the corrected boundary; a fresh
merged-main continuation remains required.

## Remaining gate

After the context-continuation correction merges:

1. Continue the verified rollback context after reproving the dark/zero-work boundary.
2. Plan, authorize, and apply restoration.
3. Repeat public authenticated save, durable completion, cross-user isolation, workload, queue,
   alarm, log, and zero-drift acceptance.
4. Clean only the ignored rollback context and saved plans.

SR-006 and D0-016 remain `In progress`.
