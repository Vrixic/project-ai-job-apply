# D1 development persisted source-pause acceptance — 2026-08-24

- Environment: development (`362544434697`, `us-east-2`)
- Exact merged source: `b215f38316ffd7d25de982168bd2c9cb1a65f6fb`
- Scope: generated-synthetic moderation and ingestion control only
- Result: accepted; environment restored default-off with zero drift

## Defect found and corrected

The first direct moderation probe reached PostgreSQL but the deployed Lambda bundle returned
`timestamp without time zone` columns as strings. The persistence mapper required JavaScript
`Date` objects. Opening therefore committed the moderation case and then returned `503`; search
returned `503`; resolution failed inside its transaction and rolled back with `500`.

Source `b215f38316ffd7d25de982168bd2c9cb1a65f6fb` makes the Jobs reporting mapper accept only a
strict bounded PostgreSQL timestamp string or a valid `Date`, and normalizes either form to the
canonical ISO instant. Focused Jobs unit tests pass `63/63`, Jobs typecheck passes, Gateway tests
pass `108/108`, and the scoped formatter/linter passes.

The governed gateway publisher produced:

- receipt:
  `.terraform/development-gateway-release/receipt-b215f38316ff-20260824-020914.json`;
- receipt SHA-256: `862b0b1aee7214b998c7889cf930bb899ca954307b52f7a6b780c30b547136ed`;
- ZIP SHA-256: `0de9c2c5a295ed739168b176e492846847351f2ae006b8cd507a5c9e8c89791e`;
- immutable S3 object version: `saB2Q67cKdzI9KTiCy48ZmLc8BR50SSi`;
- saved two-update plan SHA-256:
  `d2c4f8f64f3adf31485f16a0d4aea2dee708138d85149d7b9bdddd1f4a6548f9`.

That plan updated only the gateway function and unweighted alias. Terraform advanced from state
serial `156` to `157`, and the gateway alias advanced from version `29` to version `30`.

## Persisted moderation decision

The acceptance identity was generated and contains no provider or candidate data:

- source ID: `synthetic-foundation-v1`;
- adapter version: `synthetic-ingestion-v1`;
- seed: `foundation01`;
- adapter configuration SHA-256:
  `c700a93e080616f6e1af7470f6e35e97c9c85b30966d7943e67b9f523cba1127`.

Gateway version `30` searched the persisted open case successfully and then resolved case
`01a0324a-b0dc-77dd-ac95-71f8873fe5ef` with expected version `0`, resolution `pause_source`, and
reason `source_integrity_failure`. The returned case is version `1`, status `resolved`, opened at
`2026-08-24T05:42:30.979Z`, and resolved at `2026-08-24T06:17:19.520Z`. A resolved-case search
returned the same exact redacted identity and decision.

This direct Lambda probe supplied a fixed generated-synthetic API Gateway authorizer context. It
proves the deployed gateway, Jobs persistence, optimistic version fence, audit write, and exact
pause decision. It does **not** prove managed OIDC, API Gateway JWT/JWKS enforcement, a configured
admin grant, a hosted admin browser session, or an accountable human moderation decision.

## Enabled-run enforcement

Terraform refuses to enable a source while the ingestion runtime is disabled. The bounded
acceptance therefore temporarily enabled both runtime and the generated-synthetic source while
keeping provider activation false and provider sources exactly `[]`.

The refresh-backed enablement plan was bound to state serial `157` and had SHA-256
`df02a70d15c8ff3a6eef3fc0ccb8fedb84f908a73692df75aa6fdf79165f2a83`. It changed only the
expected ingestion durable/runtime publication, aliases, disabled-to-enabled triggers, IAM
propagation guard, and three corresponding Terraform outputs. Provider authority and provider
configuration did not change. The applied temporary state was serial `160`; coordinator alias
version `4` had `INGESTION_SYNTHETIC_SOURCE_ENABLED=true`, provider activation `false`, and provider
sources `[]`.

An exact scheduled EventBridge-shaped direct invocation at `2026-08-24T06:24:36Z` returned:

```json
{
  "scheduled": 0,
  "resumed": 0,
  "recovered": 0,
  "claimed": 0,
  "sent": 0,
  "failed": 0
}
```

The event SHA-256 is `0574295fff8a3e6b44b555acf5508dc39c0469ea415fab4b9ad20f90e29cf003`;
the response SHA-256 is `93316113bf3ae82a919b3f95d1affc3cb5119a9685b119770f2813769f0c7744`.
The enabled runtime therefore honored the persisted exact source/adapter/configuration pause before
creating or dispatching work.

## Restoration and final state

The exact restoration plan SHA-256 was
`03a03d7bf020948e9f29291db6dc1013e384800219d0cc3fb831d738de396858`. It reversed only the
temporary ingestion boundary and advanced state to serial `163`.

Final live readback shows:

- gateway alias version `30`;
- coordinator, starter, terminal, and activity aliases version `5`, all unweighted;
- durable exact version `3`, with the CloudFormation stack `UPDATE_COMPLETE`;
- ingestion runtime `false`, synthetic source `false`, provider authority `false`, provider count
  `0`;
- schedule and terminal EventBridge rules `DISABLED`;
- ingestion dispatch event-source mapping `Disabled`;
- dispatch and dead-letter queues each at zero available, in-flight, and delayed messages;
- zero ECS tasks and zero development alarms in `ALARM`;
- idle migration task definition revision `41`.

The final refresh-backed zero-drift plan is
`.terraform/development-source-pause-acceptance/zero-drift-b215f38316ff-state163.tfplan`, SHA-256
`b2dc337487cdeee97390d737591faee2be30adb1a12f455de77c25a7a00d19c6`. It contains zero resource
changes and zero output changes with every ingestion/provider activation gate false or empty.

The resolved generated-synthetic moderation/audit record remains intentionally persisted as the
acceptance decision. No provider request, provider data, candidate data, source job, dispatch,
durable execution, queue message, or ECS task was created.

## Delivery effect and remaining gates

This closes the deployed persisted source-pause acceptance gap in D1-003 and the deployed runtime
source-control gap in D1-007. It does not complete either task or Phase 1. Remaining gates include:

- exact company/board inputs and one attributable activation record per Greenhouse, Lever, or
  Ashby configuration;
- bounded live-provider provenance, revalidation, removal, and source-quality evidence;
- managed admin client/MFA grant, hosted admin UI, managed-OIDC/browser execution, and accountable
  D1P policy acceptance;
- public abuse/load/indexing and final product, accessibility, security, and privacy acceptance;
- final Phase 1 AWS PITR/object-recovery evidence, which remains intentionally deferred until the
  candidate is frozen.
