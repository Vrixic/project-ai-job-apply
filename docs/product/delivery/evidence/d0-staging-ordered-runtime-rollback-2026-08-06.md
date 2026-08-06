# D0-016 staging ordered runtime rollback — 2026-08-06

- Environment: isolated synthetic staging
- Region: `us-east-2`
- Exact deployed source: `63a8c88d9800a9b06b6dcf546bda14de564a66f6`
- Result: rollback and direct-alias conformance passed; restoration remains open

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
help-contract, infrastructure-policy, and whitespace validation pass locally. No worker task or
product-record transition was performed by this source change.

## Remaining gate

After this correction merges:

1. Generate and separately authorize the exact one-record drain context.
2. Execute the bounded retained Temporal worker and prove zero work again.
3. Plan, authorize, and apply restoration.
4. Repeat public authenticated save, durable completion, cross-user isolation, workload, queue,
   alarm, log, and zero-drift acceptance.
5. Clean only the ignored rollback context and saved plans.

SR-006 and D0-016 remain `In progress`.
