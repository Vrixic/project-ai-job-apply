# D1 Ashby Linear development activation record — 2026-08-24

- Record ID: `D1-ATS-DEV-2026-08-24-01`
- State: `Accepted for bounded development activation`
- Governing decision: [ADR-025](../../../adr/025-public-ats-feed-activation-governance.md)
- Environment: development, repository-bound AWS account, `us-east-2`
- Exact repository commit at acceptance: `38ec7e97e54d05870aafc43d092ad0c407bdeed3`
- Exact reviewed planning source: `da313e024773f0e9ea718c6dba507b9a8e812c45`
- Created and accepted at: `2026-08-24T07:03:49Z`
- Accountable product/source owner: Vrij, repository owner
- Authorized operator: Vrij through a temporary development IAM Identity Center administrator
  session

## Authority and boundary

The repository owner instructed engineering to use its recommended first provider and proceed,
after explicitly removing separate Phase 1 legal approval for Greenhouse, Lever, and Ashby. This
record selects the smallest suitable recommended source: Linear's public Ashby board. It authorizes
only the bounded development activation, inspection, and restoration sequence recorded below.

The source starts disabled. No credential, private token, candidate datum, application action,
caller-selected URL, or provider response body is stored here. The official public response
identifies Linear's hiring domain as `linear.app` and its public board as `linear`:
`https://api.ashbyhq.com/posting-api/job-board/linear`.

## Exact source configuration

| Field | Exact value |
|---|---|
| Provider | `ashby` |
| Stable source ID | `ashby-linear-v1` |
| Company display name | `Linear` |
| Verified company domain | `linear.app` |
| Ashby job-board name | `linear` |
| Greenhouse/Lever identifiers | Not applicable |
| Adapter version | `ashby-job-board-v1` |
| Configuration SHA-256 | `9936706e3f704eee9c1f27ff20842edecb1d15fd231d85ca7b73322808fd0522` |
| Provenance | `permitted_api` |
| Preflight state | Passed with `enabled: false`; one source; no network or AWS effect |

The ignored source file passed the production-parser preflight through
`scripts/validate-d1-provider-source-configuration.ps1`. Safe output contained only the provider,
source ID, adapter version, and configuration digest.

## Immutable dark-release baseline

| Field | Exact value |
|---|---|
| Migration image | `sha256:ebde3daab4a1efa3e4e0cd56df3aa2da1d4e42f5e26d578ad813bb1647175515` |
| Durable artifact SHA-256 | `9700de991c8d628cd84f5aa1942a68f74df7c22223addd335becc5e08a861bfe` |
| Runtime artifact SHA-256 | `0d98c9a9b64649210249f2c53d7b12536bc30bbea9c1ef6c2c6f69f30d116a6c` |
| Artifact application source | `db6fe0b1682da0a69d2a2aeb8a28d1655b5060df` |
| Current coordinator/starter/activity/terminal aliases | Numeric unweighted version `5` |
| Current durable version | Numeric version `3` |
| Baseline Terraform state/plan | Serial `163`; zero-drift SHA-256 `b2dc337487cdeee97390d737591faee2be30adb1a12f455de77c25a7a00d19c6` |
| Activation plan SHA-256 | `ad458952929d95a94299671879d1bfdfcd83c1571a7aff61525dcebc6aee01a5` |
| Activation plan creation | `2026-08-24T07:19:44Z`; refreshed serial `163` baseline |
| Activation allowlist | Exact ingestion resources and provider-only egress resources listed below |
| Restoration plan | Must be generated from the post-activation serial before manual invocation; exact inverse/default-off boundary accepted below |

## Rejected first plan and egress remediation

The first saved activation plan, SHA-256
`515f06bae5a4d10e14c276268fd9c832e1837c3d479cbc5035b907f956608d13`, was rejected before apply.
Its provider/runtime changes were exact, but `private_application_networking=true` would have added
default NAT routes to both shared private route tables. The gateway, public projection, and other
private Lambdas share those subnets and their application security group permits outbound traffic;
the plan therefore broadened internet egress beyond ingestion.

Exact merged remediation `741440a151632291cec93448290e4d3b3c4c8e69` adds a separate default-false
`ingestion_provider_private_egress` gate. Only an exact authorized enabled provider may create its
two dedicated private subnets, route tables, and bounded NAT. Only the provider-fetch ingestion
activity moves to those subnets; coordinator, starter, terminal, gateway, public projection, and
all shared private subnets retain no default internet route. Disabling the gate moves the activity
back before the provider-only network is removed.

Development and staging Terraform validation, recursive formatting, all platform module tests
`28/28`, and the development baseline/operator regressions in PowerShell 7 and Windows PowerShell
5.1 pass. No rejected-plan action was applied and development remains at serial `163`.

## Accepted isolated activation plan

The replacement saved plan has `9 add`, `14 update`, `1 create-before-delete` replacement, and one
read-only data refresh. Its 24 non-no-op addresses are limited to:

- two provider-only subnets, two provider-only route tables, two associations, one provider NAT,
  and one EIP;
- the activity function plus its alias, and the coordinator/starter/terminal functions plus their
  aliases, whose exact version/configuration references advance together;
- the ingestion durable stack and its exact IAM policy document/policy;
- the ingestion schedule, terminal rule, queue mapping, and activation guard; and
- the ingestion IAM propagation delay, whose only delete is its create-before-delete replacement.

Machine review proves all 86 variables are present; shared
`private_application_networking=false`; provider-only egress/runtime/provider authority are true;
synthetic source and public-job route authority are false; and the only source is the exact enabled
`ashby-linear-v1` configuration above. There are zero shared-private-route changes and zero
unexpected addresses. The plan changes no gateway/public-job/document/database/ECS/application
route, artifact identity, candidate data, public route, indexing switch, or non-ingestion runtime.

The post-activation restoration must use the same 86-variable baseline with runtime, provider
authority, provider-only egress, and every source disabled/empty. Its reviewed plan may only reverse
the accepted activation addresses, publish the necessary default-off function/durable versions,
and remove the provider-only network after the activity returns to shared private subnets. It must
leave shared private route tables unchanged. Generate and checksum that plan immediately after the
activation apply and before manual workload invocation; if it contains anything else, stop.

## Bounded operating contract

| Control | Accepted exact behavior |
|---|---|
| Acquisition | Provider-published unauthenticated fixed-host GET only |
| URL | Adapter-owned `https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=false` |
| Reconciliation | Five-minute rule; at most one idempotent hourly occurrence |
| Request/response/observation bounds | Five seconds; 1,000,000 bytes; 100 observations |
| Redirect/host/port/caller URL | Refused |
| Egress | Private NAT only while provider authority is true |
| Telemetry | Aggregate identifiers/counts/statuses only; no response bodies |
| Failed or empty poll | Does not prove withdrawal and does not close jobs |
| Positive revalidation/removal | Required before source acceptance |
| Public truth | `isListed: false` excluded; incomplete/remote structured data suppressed |
| Pause | Exact source + adapter + configuration digest; no resume operation |
| Reactivation | New activation record required after any pause or configuration change |

## First bounded attempt, correction, and retry authorization

The accepted isolated plan was applied without changing its SHA-256. Development reached serial
`168` with the exact Linear source, provider-only NAT, runtime, schedule, and queue mapping enabled.
The five-minute rule first invoked the prior default-off alias during the ordered apply and returned
all zero counts. At `2026-08-24T07:28:06Z`, the completed alias advance created and sent exactly one
hourly occurrence. No provider request occurred: durable version `3` still referenced activity
version `3`, while the persisted dispatch correctly froze newly published activity version `6`.
The activity therefore failed closed with `IngestionActivityDispatchRejected` before acquisition.
The durable function retained its identifier-only input in the encrypted DLQ; its body SHA-256 was
`9537b77e28914b714181813efe168cf0e2a8ea3ca3cd6eb90df6a6494508b0a8` and its only fields were the
schema/workflow version, dispatch ID, execution ID, and generation. The terminal handler also
rejected the real AWS terminal event, but its asynchronous invocation had no function-level DLQ,
so the original event was not retained after Lambda's bounded retries.

The pre-generated restoration plan SHA-256
`1e124b2b0be6b89a2517cc7f2a6d0efc59ccfd71f15724e716aa2f85069a6718` disabled both rules and the
queue mapping, returned the activity to shared private subnets, removed NAT/EIP/default routes, and
restored every activation output false/empty. State reached serial `170`; its last two subnet
deletes were interrupted only after the safety boundary was already dark because retained Lambda
versions held provider-subnet VPC attachments. No candidate data, provider response, provider job,
public route, or indexing action existed. The exact failed DLQ envelope was then deleted after its
identity and digest were recorded.

Exact merged correction `4b151f8598912714e428368ef17c44599bfc1084`:

- binds the activity's numeric version ARN into the `AWS::Lambda::Version` description, which
  CloudFormation replaces whenever the activity version changes, so the durable and persisted
  activity versions advance together;
- adds encrypted function-level DLQs for asynchronous coordinator and terminal handler failures;
- retains the free provider-only subnets and empty route tables in the dark deployment while
  deleting only cost-bearing NAT/EIP/default routes during restoration, preserving immutable
  rollback versions without hidden subnet deletion dependencies; and
- passes all platform tests `28/28`, development/staging validation, recursive Terraform format,
  the serverless infrastructure validator, and whitespace checks.

The default-off correction plan SHA-256
`7bd0dfa1ed92359081148a00d59aca76085e2b5316dd805039bb46e0a69d4da1` applied at serial `170` and
advanced development to serial `172`. Durable version `4` and runtime aliases
coordinator/starter/terminal `8` all reference activity version `7`; coordinator and terminal have
the encrypted DLQ; runtime/provider/egress/synthetic gates are false/false/false/false; source count
is zero; rules/mapping remain disabled; and retained provider route tables contain no default route.

The reviewed retry plan is
`.terraform/development-provider-activation/retry-activation-ashby-linear-20260824-080548.tfplan`,
SHA-256 `2dbc709aa527b235207bcc357592458e47e555c58407e13c38591fe3c4fdc52c`, from the exact serial-`172`
baseline and implementation source above. Its 20 non-no-op records are limited to one EIP/NAT,
two provider-only default-route updates, the activity/durable/runtime version chain, exact ingestion
rules/mapping/guard/policy changes, one propagation replacement, and one read-only policy refresh.
It changes no subnet, shared route, gateway/public-job/document/database/ECS/application route,
candidate data, public route, or indexing switch. This record authorizes only that saved retry plan,
immediate default-off restoration planning, bounded acceptance, and restoration.

## Activation and acceptance sequence

| Gate | State | Evidence |
|---|---:|---|
| Repository-owner provider recommendation and proceed instruction | true | Active implementation instruction |
| Exact public company/domain/board verified | true | Official public Ashby response |
| Default-off production preflight | true | Exact safe descriptor above |
| Accountable owner accepted bounded planning | true | This record |
| Immutable dark artifacts/readback | true | Existing provider-capable dark-release evidence |
| Saved plan inside reviewed activation allowlist | true | Exact replacement plan above |
| Plan identity inserted and apply accepted | true | This reviewed record |
| Provider authority/source/runtime applied | true, then restored | First bounded attempt reached serial `168`; current serial `172` is default-off |
| Bounded provider request/provenance | false | Pending |
| Canonical persistence/deduplication/public truth | false | Pending |
| Positive revalidation/removal and failed-poll safety | false | Pending |
| Exact persisted pause blocks new work | false | Pending for this live source |
| Retention or exact cleanup disposition | false | Pending |
| Alarms/queues/tasks/log redaction | partial | First failure was aggregate-only and its exact identifier-only DLQ item was removed; final retry evidence pending |
| Default-off restoration and zero drift | partial | Safety boundary restored through serial `172`; final retry restoration and zero drift pending |
| Product/source-quality residual acceptance | false | Pending |

## Current disposition

- Decision: exact bounded development activation, inspection, and restoration accepted.
- Apply authority: only retry saved plan SHA-256
  `2dbc709aa527b235207bcc357592458e47e555c58407e13c38591fe3c4fdc52c`; any refreshed or changed
  plan requires a new review. The original accepted plan was consumed once and is no longer valid.
- Public route/indexing: prohibited by unchanged false gates.
- Production/candidate/application authority: none.
- Source after the bounded attempt: default recommendation is disabled until public-route and
  source-quality acceptance.
- Correction/takedown owner: pending final D1P acceptance; no public route exists.
- Supersedes: none.
