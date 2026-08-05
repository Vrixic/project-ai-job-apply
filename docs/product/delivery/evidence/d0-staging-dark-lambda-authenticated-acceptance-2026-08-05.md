# D0-016 Staging Dark Lambda Authenticated Acceptance — 2026-08-05

- Environment: isolated synthetic staging
- Region: `us-east-2`
- Exact merged source: `32e8f6fad5da93b3ab2611ed6e600db407f05d3a`
- Runtime under test: immutable staging gateway Lambda alias
- Public runtime during test: retained idle ECS HTTP integration
- Identity boundary: shared development Auth0 issuer under ADR-014
- Result: passed

## Outcome

The staging gateway Lambda passed automated request-boundary checks, authenticated preference
persistence, and two-account operation isolation through the real web/BFF conformance path. The
second account received only the expected non-disclosing result:

`Cross-user isolation passed: this account could not read the first account’s operation.`

This completes the authenticated gateway-acceptance portion of SR-006. It does not complete
SR-006 or authorize cutover. Public API routing remains on the retained idle ECS integration,
replacement workflow triggers remain disabled, and the three synthetic outbox records created by
the browser probes remain queued for controlled cutover and completion evidence.

## Source corrections and verification

Four merged changes made the staging acceptance path reproducible without weakening the normal
conformance boundary:

- [PR #135](https://github.com/Vrixic/project-ai-job-apply/pull/135) generalized deployed web
  conformance across development and staging.
- [PR #136](https://github.com/Vrixic/project-ai-job-apply/pull/136) resolved the initialized
  Terraform backend metadata instead of relying on an obsolete bucket-name convention.
- [PR #137](https://github.com/Vrixic/project-ai-job-apply/pull/137) allowed an owner-visible queued
  operation to arm the isolation probe only in explicit local dark-conformance mode.
- [PR #138](https://github.com/Vrixic/project-ai-job-apply/pull/138) centralized that eligibility
  rule so the browser control and server handler cannot diverge.

The final source passed the repository check suite, including 34 web tests. The exact merged-main
staging preflight and postflight then proved the immutable alias, JWT authorizer, staging
AWS/Terraform/Auth0 alignment, idle ECS rollback boundary, disabled workflow triggers, and
unchanged public integration.

## Automated boundary evidence

The deployed no-write matrix passed all 15 cases with the expected aggregate status sequence:

- one public success (`200`);
- four authentication denials (`401`);
- one authorization denial (`403`);
- three non-disclosing missing-route/object results (`404`);
- three request-shape rejections (`400`);
- one media-type rejection (`415`);
- one base64/body rejection (`400`); and
- one oversized-payload rejection (`413`).

The bridge smoke returned `200/200/401`. The matrix reported no public-traffic change and no
persistent application writes. A final repeat after browser acceptance produced the same 15-case
result and the same unchanged-boundary assertions.

## Authenticated browser evidence

The product owner completed the two-account sequence against the immutable staging alias:

1. Account A authenticated through Auth0, saved harmless synthetic preferences through the web
   BFF and local conformance bridge, and received its owner-scoped queued operation.
2. The conformance control encrypted and retained only an expiring local operation probe after
   verifying that Account A could read the operation.
3. Account B authenticated independently and ran the check against Account A's operation.
4. The owner-scoped API returned the non-disclosing not-found boundary, and the browser displayed
   the pass result quoted above.

Queued is the expected operation state while the staging SQS/EventBridge replacement triggers are
dark. It is not treated as workflow-completion evidence.

No bearer token, provider subject, email address, preference body, operation identifier, account
identifier, endpoint, credential, secret, raw request, or raw log is retained in this record.

## Post-test state

Read-only inspection after the browser run found:

- retained ECS gateway and worker services at `0/0/0`;
- public API routing still on the retained ECS rollback integration;
- zero enabled workflow-starter event-source mappings;
- the reconciler schedule disabled;
- three pending synthetic outbox records, with maximum attempt count `0`;
- 177 aggregate CloudWatch events across nine streams in the inspected four-hour window;
- zero unexpected error/failure patterns; and
- zero credential, token, connection-string, or email patterns.

The outbox records were intentionally left untouched. Controlled staging cutover must bind new
events to the Lambda workflow route, drain these three records exactly once effectively, prove
their operations reach the expected successful terminal state, and retain rollback safety.

## Limitations and next gate

- Staging temporarily trusts the development Auth0 tenant under
  [ADR-014](../../../adr/014-shared-development-auth0-for-synthetic-staging.md). This proves the
  application ownership boundary, not independent identity-provider isolation or launch readiness.
- API Gateway has not been cut over from the retained ECS integration.
- Workflow starter and reconciler triggers remain disabled.
- The browser gate did not prove workflow completion; its three synthetic operations are queued.
- No AWS infrastructure mutation or routing change occurred during this acceptance. The final
  outbox and log checks used short-lived read-only inspection tasks.

The next SR-006 gate is a separately reviewed controlled staging cutover followed by exact backlog
drain, authenticated workflow completion, failure/recovery, fixed-workload, rollback-window, log,
alarm, and zero-drift evidence.
