# D0 Development Bad-Image Rollback Evidence — 2026-07-30

## Scope

This record covers a controlled immutable bad-image rollout and good-image rollback for the
gateway in the dedicated synthetic AWS development environment in `us-east-2`. It proves that the
one-task lean deployment preserves its current healthy gateway while rejecting a bad revision,
and that the approved revision can be restored without changing the worker or persistent
infrastructure.

It does not prove PostgreSQL restore, runtime-secret rotation, provider/log-stream outage
recovery, on-demand staging acceptance, production high availability, or accountable
legal/privacy or security/privacy approval.

No AWS account or infrastructure identifier, task identifier, IP address, provider value, raw log
event, candidate value, identity, token, or secret is retained in this record.

## Preconditions

The drill ran from merged `main` commit
`16c5fa8dec6cc5814315b932b92d2443e3857e35`, after the distributed-tracing evidence merged in
[PR #27](https://github.com/Vrixic/project-ai-job-apply/pull/27).

Sanitized preflight established:

- the caller used a temporary IAM Identity Center assumed role;
- Terraform `1.9.8` reported a refresh-backed no-drift baseline;
- gateway and workflow worker each reported one desired, one running, and zero pending tasks with
  completed primary deployments;
- the gateway rolling configuration preserved `100%` minimum healthy capacity and allowed `200%`
  maximum capacity;
- both deployed image indexes were immutable, contained exactly one `linux/amd64` manifest, and
  had complete ECR scans with zero critical, high, medium, or low findings;
- the gateway task and both collectors were healthy;
- Cloud Map contained one healthy gateway registration; and
- live/readiness returned `200` while an unauthenticated protected request returned `401`.

## Controlled bad revision

The already approved immutable worker image was used as the controlled wrong gateway image. This
avoided publishing an intentionally vulnerable or mutable artifact: the worker runtime cannot
satisfy the gateway process and liveness contract.

The saved bad-revision plan had SHA-256
`71FF8CA54A6A47A19DEE2B0B4740C933A96C07FE8A7D458AE9AE547D6EF9213C`. Semantic inspection
accepted exactly:

- one gateway task-definition replacement;
- one gateway service task-revision update;
- the gateway image and derived release marker as the only application changes;
- an unchanged fail-open collector and gateway health check; and
- zero worker, desired-count, provider, database, queue, network, storage, secret, alarm, or other
  persistent-resource changes.

The exact artifact applied successfully. ECS started the controlled revision while retaining the
previous healthy gateway. Three controlled tasks ultimately stopped with application exit code
`1`: two were classified as essential-container exits and one was scheduler-stopped during
rollback. The service recorded the failed revision while the original task remained healthy.
Live and readiness returned `200` throughout the observed failure window.

## Exact rollback

The approved gateway image was reconstructed from the reviewed bad plan's before-state rather
than from a mutable tag. The saved rollback plan had SHA-256
`6CF39A0AFD2D502E10919D4AFCB4211D9F5314B35FFBB2AA4C3BD99DA6F53F79` and contained exactly the
same one task-definition replacement and one service update in reverse. It changed no worker or
persistent resource.

After the exact rollback artifact applied:

- gateway and workflow worker each converged to one desired, one running, and zero pending tasks;
- each service had one completed primary deployment and zero failed tasks;
- both application containers ran their original approved immutable digests;
- the gateway task and essential container were healthy;
- both nonessential collectors were running and healthy;
- Cloud Map contained exactly one healthy gateway registration;
- live/readiness returned `200`;
- an unauthenticated protected request returned `401`; and
- all six managed development alarms reported `OK`.

Aggregate inspection of the three controlled-task log streams found 27 events, including six
expected error-class events. It found zero forbidden candidate or credential field patterns, zero
email patterns, and zero JWT patterns. No raw event was retained.

A final refresh-backed Terraform plan reconstructed the exact restored images, provider settings,
task sizing, database settings, tracing configuration, and lean-runtime inputs in memory. It
returned detailed exit code `0`, proving no drift. The local saved plan artifacts were deleted
after their hashes and outcomes were recorded.

This closes the immutable bad-image rollback substep of D0-011. Phase 0 remains in progress behind
the recorded identity/provider, runtime-secret rotation, isolated PostgreSQL restore, on-demand
staging, fixture/quality, and accountable approval gates.
