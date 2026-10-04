# D3-069: Native preparation durable entrypoint

Date: 2026-10-04
Status: Source/focused verification passed; full verifier and source-bound artifact pending.

The backend-only branch starts from freshly fetched main `bde17d9`, then locally integrates
exact open #538 head `c493a7ef` as an explicit dependency. No GitHub merge is performed.

## Result and boundary

The native `application-preparation-durable-lambda.ts` exports a default-off entrypoint around
the existing deterministic SDK workflow. Qualification occurs outside SDK workflow code:
exact `APPLICATION_PREPARATION_DURABLE_ENABLED=true`, us-east-2, expected account/name/numeric
invoked version and a distinct same-account numeric `APPLICATION_PREPARATION_ACTIVITY_FUNCTION_ARN`.
Database credentials, object/KMS configuration and model/provider targets/secrets are refused.
Default-off, invalid configuration and foreign invoked targets throw only the fixed
`ApplicationPreparationWorkflowUnavailable` error before SDK control-envelope/state access.
No environment, secret, database, object or model I/O occurs at module load.

The first qualified call pins the workflow/activity configuration. Warm drift refuses retargeting
and activation withdrawal refuses subsequent invocations/resumes. The original SDK control
envelope is delegated unchanged; continuation/checkpoint exceptions are not wrapped. Existing
strict identifier-only payload validation, named deterministic advance/compensation operations,
classified retry policy (five attempts each) and private activity result validation are unchanged.
SDK checkpoints/output contain event/preparation identifiers and fixed outcomes, never document
text, candidate facts or credentials. Processing completion is not proof of a successful draft;
Applications persistence remains product truth. Configuration/kill-switch changes do not prove
that an already-issued remote effect stopped or that a writer is quiescent. Exact target matching
is not caller authentication. Numeric immutable release configuration remains required.

## Executed local checks

- 31 new native tests and 18 existing workflow/activity/contract tests pass (49 focused).
  Refusal covers missing/default-off/nonliteral flags, wrong region/account/function/version,
  aliases/leading-zero versions, foreign/self activity functions and incompatible private/provider
  configuration before SDK state handling. Configuration-reader exceptions remain fixed.
- Five installed SDK runner cases exercise the actual native wrapper: completed checkpoint replay
  with one private effect, identical retry of a pending original effect, five advances followed
  by metadata-only compensation, strict injected text/target refusal before private invocation,
  and warm activation withdrawal. Warm activity-version drift cannot recompose or invoke.
  Lambda context and private activity outcomes are simulated; retry time is skipped.
- Workflow typecheck/build pass. The compiled bundle guard positively requires the original
  workflow and installed SDK, while refusing emitted owning services/workers, AI SDK, SQL and
  private activity/preparation/dispatcher/recovery implementations. The maintained verifier
  now includes this isolation guard. No wire, event, domain, migration or retry semantics change.

Local environment: Windows, Node 24.12.0, pnpm 10.24.0 and installed AWS durable SDK/test runner.
No database/persistence change requires SQL repetition in this slice; prior connected native
private-activity evidence remains in D3-068. No browser/UI change, live AWS/provider/model call,
artifact publication, deployment, activation or Docker/WSL startup occurs. Ignored logs:
`.tmp/d3-069-focused-final.log`, `.tmp/d3-069-typecheck.log`, `.tmp/d3-069-build.log`,
`.tmp/d3-069-bundle.log`.

## Remaining gates

Full maintained exact-source verification and source-bound local artifact checks remain pending.
Native dispatcher/terminal recovery/release wiring, caller/checkpoint/activity IAM, retained exact
versions, maintained scheduling, retention/abandonment/original writer drain and accountable/
deployed acceptance remain. No phase-exit box changes; D1/D3 stay In progress. Hosted CI/CD
remains deferred until production launch.
