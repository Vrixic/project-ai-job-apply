# D0-016 staging workflow dark-conformance operator evidence

- Date: 2026-08-04
- Environment: Development and isolated synthetic staging source boundary
- Status: Source complete and locally verified; no conformance context or AWS mutation

## Maintained implementation

The proven development workflow drill is now one environment-aware operator for exactly
`development` or `staging`. Thin wrappers fix the selected environment and its default IAM Identity
Center profile, preserving the existing development command while avoiding a duplicated
safety-critical implementation.

For the selected environment, the shared operator derives the Terraform state directory, ignored
review context, resource prefix, five functions and aliases, two disabled EventBridge rules, seven
alarms, durable DLQ and stack, API, ECS cluster, and gateway dispatch boundary. Its context schema
also includes the exact environment so a checksum from one account cannot be replayed through the
other wrapper.

Planning now fails before AWS access unless the repository is clean `main` at its exact configured
upstream commit. Execution additionally requires the same source commit, unchanged shared-operator
hash, exact context checksum, unchanged completed-dark zero-change plan, and byte-identical live
boundary. Emergency cleanup remains constrained to the uniquely reviewed durable execution and
byte-identical synthetic DLQ message.

## Execution boundary

The separately authorized execution remains limited to:

- synchronous invalid-input probes against the exact numeric activity, starter, and terminal
  versions;
- one uniquely named asynchronous invalid execution against the exact durable numeric version;
- one expected byte-identical synthetic DLQ message and one exact deletion; and
- two owned alarms completing `OK → ALARM → OK`, for four transitions total.

The operator does not invoke the reconciler, send a product SQS event, write product data, enable
the SQS mapping or EventBridge schedules, change API routing, start ECS tasks, or change Temporal
dispatch. It removes the ignored context only after the DLQ, alarms, and complete live boundary
recover.

## Local verification

- all three PowerShell files parse without errors;
- development and staging wrappers expose the same parameter surface and delegate to the shared
  operator with fixed environments;
- both wrapper help paths pass without AWS access;
- an attempted staging plan from the intentionally dirty worktree fails on exact-upstream
  provenance before AWS access;
- the infrastructure policy validator enforces shared environment derivation, upstream/source
  guards, disabled-trigger/no-traffic context values, absence of development-only resource names,
  and both wrapper/profile bindings; and
- the full repository check and Markdown-link/whitespace checks pass.

No function was invoked, no alarm or DLQ was changed, no conformance context was created, and no
AWS, Terraform, API, ECS, Temporal, identity, product, or candidate-data state changed.

## Next gate

Merge the source and synchronize exact clean `main`. Regenerate the staging completed-dark
zero-change plan from that same commit, then run the staging wrapper in `Plan` mode. Independently
review the live boundary and generated context and require separate authorization of its SHA-256
before any synthetic invocation.
