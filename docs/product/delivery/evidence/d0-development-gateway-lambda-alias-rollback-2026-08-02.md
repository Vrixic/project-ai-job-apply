# D0-016 Development Gateway Lambda Alias Rollback — 2026-08-02

- Environment: development
- Region: `us-east-2`
- Runtime under test: unrouted gateway Lambda alias
- Public runtime throughout: existing ECS gateway
- Result: passed

## Outcome

The checksum- and revision-gated operator moved the dark development alias from accepted immutable
version `3` to accepted immutable version `2`, required the guarded bridge to return
`200/200/401`, and restored version `3` in `finally`. The restored version returned the same
`200/200/401` result and the full AWS/Terraform/Auth0 deployment preflight passed.

Exactly two alias updates occurred. No API integration, public route, Lambda function artifact,
Terraform resource, ECS service, database, queue, secret, alarm, IAM policy, KMS key, or network
resource changed. The ignored recovery context was removed only after exact restoration and health
checks passed.

## Reviewed execution

The successful exact-main execution used reviewed context SHA-256
`e0aa66d7011249c355041b14e6efbbf9e146132edf2c9286bbb314dcebcfb9b9` and reported:

| Check | Result |
|---|---:|
| Rollback alias version | `2` |
| Restored alias version | `3` |
| Rollback bridge | `200/200/401` |
| Restore bridge | `200/200/401` |
| Alias updates | `2` |
| Public traffic changes | `0` |
| Recovery context removed | Yes |

An earlier checksum-approved attempt encountered pre-existing local listeners on the two guarded
bridge ports. The operator restored version `3` through its `finally` boundary and retained its
context because smoke acceptance had not completed. After stopping only those local development
listeners, current-version bridge and full preflight checks passed, guarded cleanup removed the
stale context, and a new alias revision produced the separately reviewed successful context above.
The stale checksum was not reused.

## Post-restore verification

Read-only inspection after the successful drill established:

- the alias targets unweighted immutable version `3`;
- the exact recovery context no longer exists;
- all three Lambda error, throttle, and duration alarms are `OK` with actions enabled;
- the completed-dark Terraform verifier found all 11 reviewed resources and zero creates,
  updates, deletes, replacements, drift, or API traffic changes;
- ECS remained stable as the public rollback runtime; and
- aggregate inspection of 363 recent encrypted application-log events found zero application-error
  levels, runtime-failure signals, credential/token patterns, candidate-field patterns, or email
  values.

The completed-dark verifier used the exact deployed immutable artifact, pinned extension layer
`114`, reserved concurrency `2`, and produced diagnostic plan SHA-256
`37fd9777e94134dc11fa7fa93f73d5c6793cb6e0a4c3467bb40bac49ef9baf1c`. The plan was diagnostic
only and was not applied.

## Disposition

The development dark-gateway alias rollback gate is complete. This evidence does not claim or
authorize public API cutover, SQS/outbox replacement, Lambda durable workflow acceptance, staging
parity, ECS scale-down, Temporal retirement, obsolete-resource deletion, or D0-016 completion.

The next engineering task is SR-003: implement and prove the SQS nudge, starter, reconciler, DLQ,
and exactly-once-effective outbox protocol while public traffic and normal workflow dispatch remain
on the accepted ECS/Temporal path.
