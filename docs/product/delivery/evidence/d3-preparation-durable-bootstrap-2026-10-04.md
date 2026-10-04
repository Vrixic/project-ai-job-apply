# D3-069: Native preparation durable entrypoint

Date: 2026-10-04
Status: Source/focused, exact-source full verifier and local artifact checks passed; review/release gates remain.

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

Full maintained exact-source verification and source-bound local artifact checks pass as recorded below.
Native dispatcher/terminal recovery/release wiring, caller/checkpoint/activity IAM, retained exact
versions, maintained scheduling, retention/abandonment/original writer drain and accountable/
deployed acceptance remain. No phase-exit box changes; D1/D3 stay In progress. Hosted CI/CD
remains deferred until production launch.

## Final exact-source verification and artifact

Clean source `6986b2b92ca51a6fa71e90a9bb44d94af796e474` passes the maintained
`scripts/verify-phase0.ps1` with terminal exit 0 and its completion marker: 38 typecheck tasks,
39 test tasks and 23 builds. All 1,503 Workflow tests pass; 31 opt-in tests remain explicitly
skipped in the default runner. No separate SQL execution is claimed for this orchestration-only
change. Lint stays at zero errors, 15 warnings and 58 informational notes. Formatting, generated
contracts, dependency-security regressions, operational/security guards, all provider/private/
orchestration emitted-isolation checks and Compose configuration pass. Ignored log:
`.tmp/d3-069-full-verification-6986b2b.log`.

One separate unpublished native durable family builds from the same clean source. Manifest
schema 2 specifies Node24/x86_64 and index.handler. Archive SHA256:
`0c292a8e3550d7cda1de1a346201f6f1c1a98f90828e9f181724545005271a08`
(325,007 bytes; 27 SBOM components). Independent checks verify archive bytes/size/base64 digest,
sole index.mjs member, bundle file/hash/source marker and SBOM hash/component count against
the manifest. Actual bytes contain no model endpoint, ModelGateway, Applications SQL store or
cover-letter S3 store. The builder probes the actual bundled handler for default-off and
activation-configured wrong numeric invoked version, both before SDK control-envelope/state
access with zero fetches. The installed SDK unit runs separately prove the qualified wrapped
path, retry/compensation and checkpoint replay with simulated Lambda context/private outcomes.

New evidence links resolve and original phase/tracker history is retained. Only delivery
documentation follows verified source. Nothing is published, deployed or activated; no database/
UI/source-contract shape changes or Docker/WSL startup occur. Native dispatcher/terminal-recovery/
release, caller/checkpoint/activity IAM, retained versions, maintained scheduling, retention/
abandonment/original writer drain and accountable/deployed acceptance remain. D1/D3 stay
In progress, with hosted CI/CD deferred until production launch.
