# Serverless Distributed Tracing

Use this read-only procedure after a synthetic preference save reaches a succeeded operation.
Verify privacy-safe W3C correlation across API Gateway/Lambda, the transactional outbox, SQS
starter/reconciler, Lambda durable execution, and private PostgreSQL activity.

Require immutable aliases, `200/200/401`, enabled durable triggers, healthy alarms, and an empty
DLQ before inspection. Query only a bounded recent synthetic window and retain aggregate counts.

A valid trace chain contains the gateway request, outbox publication or reconciliation, durable
start, readiness activity, and terminal update without candidate content. Logs, traces, durable
history, queues, and evidence must not contain authorization headers, tokens, secrets, email,
resume data, preference bodies, sensitive answers, raw provider pages, database URLs, or unbounded
identifiers.

If a segment is absent, inspect the owning Lambda's version, permissions, sampling configuration,
and aggregate error metrics. Do not enable payload capture or widen production logging to diagnose
correlation. Re-run one bounded synthetic operation after correction and record only pass/fail,
timestamps, service names, and segment counts.

