# D1 Ashby Linear development activation record — 2026-08-24

- Record ID: `D1-ATS-DEV-2026-08-24-01`
- State: `Activation executed; default-off restoration complete; terminal settlement release pending`
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

## Corrected live retry, restoration, and terminal settlement

The exact reviewed retry plan was applied unchanged. At `2026-08-24T08:14:27Z`, coordinator
version `9` scheduled, claimed, and sent exactly one occurrence. Starter version `9` and activity
version `8` completed without an activity error. Durable version `5` execution
`3043b5f16a21941ec011a4385812c7710bd7f4390af8d8de7273bf31f363df61` succeeded from
`2026-08-24T08:14:30.021Z` through `2026-08-24T08:14:35.426Z`. This is a bounded real request to
the accepted public Ashby Linear board through provider-only NAT. The coordinator's immediate
idempotency check returned all zero counts, and both dispatch/DLQ queues were empty before the
terminal handler exhausted its retries. No response body or job value is retained in this record.

The terminal handler rejected AWS's successful terminal event because the implementation required
an empty `resources` array while the real event correctly contained the exact numeric durable
function ARN. The encrypted function DLQ retained that metadata-only event. Its body SHA-256 is
`6fe09cf3ae2a17834eb56d69cd077b0c1635060d38816aa6743db0661394e8e9`; its envelope/detail keys
exactly match the accepted event contract; its only resource and `detail.functionArn` are the same
durable version `5`; and it contains no provider response or candidate data.

The pre-generated restoration plan SHA-256
`494ef21adb838fd1fef426fe1e84a7d678c99e093348566e61c04c50055c0e39` then applied successfully:
both rules and the queue mapping are disabled, provider/runtime/egress/synthetic authority is
false/false/false/false, source count is zero, the activity returned to the shared dark network,
and the NAT, EIP, and provider default routes were removed. The retained provider subnets and empty
route tables have no default route. Durable version `6` and the matching default-off activity/runtime
versions were published without broadening any shared route.

Source `eb39435fc0859299e0f83974461caa236d49ca1c` corrects and regression-tests the exact AWS
`resources` binding. Its deterministic durable/runtime artifacts, SHA-256
`081195a01c909a33344a8df62900830f97cb0003da1fe04480c6c4bd7d8128e9` and
`f7b7badfb52ca9ac2ee971fa2f203b81250182ca874c9bf11c2d83ead9a38826`, passed eight-object
version/checksum/metadata/CMK readback. Saved plan SHA-256
`54b7c4d9020ffbe3734f3533beda603295f71b7c89a623c98f46f7d6f1ef84b2` changed only the dark
ingestion artifact/version chain and advanced it to activity `10`, runtime aliases `11`, and durable
version `7`. Replaying the preserved event then passed event validation and idempotently recorded
the successful terminal transition, but recovery configuration was still required after success;
the empty default-off source list correctly supplied no active adapter configuration, so replay
failed closed and the DLQ item remained preserved.

Source `8913304166f8a270a12d1dc4e35255834a4fe5a4` now returns immediately after a successful terminal
transition and requires active adapter configuration only for failed-terminal recovery. All workflow
tests `44/44`, typecheck, formatting, lint, and two deterministic builds pass. Its exact durable and
runtime artifact SHA-256 values are
`c41cde65c9dcae9ceb269b8da2405a6cdd7f95c41c18a29baaf77293fad5b0c9` and
`fb1bace48080353fcfbf2288661d5e7d423cd24ca7797e27dd4a479ca2aa6be1`; all eight immutable objects
passed exact-version checksum, source metadata, customer-KMS, and bucket-key readback. Final
default-off planning is temporarily blocked only by an expired development IAM Identity Center
session. No final artifact apply, terminal replay deletion, database aggregate inspection,
positive-removal exercise, or zero-drift claim is made yet.

Exact source `5cbf71e404ef9334c5ca9d7f91fe048ddc2af82e` supersedes that release candidate for
the final dark deployment while retaining both terminal-settlement corrections. It adds explicit
identity-only Ashby withdrawal for `isListed: false` and Jobs migration
`0011_positive_source_withdrawal`. Empty or failed polls cannot infer removal; exact source
identity, stale/idempotent safety, all-active-source exact-cluster withdrawal, raw/public-truth
clearing, manual-terminal preservation, and reason-bounded relisting are enforced. The composed
20-migration manifest SHA-256 is
`e08967c746fcd2a5a7471f038382c879eb3df7d6d1ee001508a9efaeed402945`. Ingestion unit
`77/77`, Jobs unit `63/63`, migration unit `35/35`, Jobs PostgreSQL `41/41`, ingestion PostgreSQL
`1/1`, fresh distinct-target restore `4/4`, infrastructure validation, all 31 type-check tasks, all
32 test tasks, and all 19 build tasks pass. This is source/local acceptance only: no final migration
image, Jobs `0011` apply, Lambda artifact deployment, or cloud withdrawal exercise is claimed yet.

Source `e45d24345ab4e9d2b87aa91495558b49661156cc` then closes a recovery-window mismatch found
while staging the preserved replay: exact terminal events now remain replayable for the encrypted
DLQ's configured 14-day retention instead of only two hours. The five-minute future bound and exact
account, region, resource, numeric function version, execution identity, timestamp coherence, and
idempotent database settlement remain enforced. Focused terminal tests pass `20/20`, workflow
typecheck passes, and scoped formatting plus whitespace checks pass. The final clean descendant must
be rebuilt and deployed before the preserved event is replayed or deleted.

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
| Provider authority/source/runtime applied | true, then restored | Corrected retry ran once; rules/mapping/gates/NAT are now default-off |
| Bounded provider request/provenance | true | Durable version `5` succeeded through the accepted Ashby adapter and provider-only NAT |
| Canonical persistence/deduplication/public truth | false | Pending |
| Positive revalidation/removal and failed-poll safety | source/local true; deployed false | Exact source `5cbf71e404ef9334c5ca9d7f91fe048ddc2af82e`; Jobs `0011`; focused PostgreSQL and restore gates pass; cloud apply/exercise pending |
| Exact persisted pause blocks new work | false | Pending for this live source |
| Retention or exact cleanup disposition | false | Pending |
| Alarms/queues/tasks/log redaction | partial | Runtime logs are aggregate-only; one metadata-only successful terminal event remains preserved in the encrypted DLQ pending corrected replay |
| Default-off restoration and zero drift | partial | Rules/mapping/gates/NAT are restored dark; final settlement artifact deployment and refresh-backed zero drift remain |
| Product/source-quality residual acceptance | false | Pending |

## Current disposition

- Decision: exact bounded development activation, inspection, and restoration accepted.
- Apply authority: the activation and restoration plans were consumed once and are no longer valid.
  Only a reviewed default-off plan built from the final clean descendant of implementation sources
  `5cbf71e404ef9334c5ca9d7f91fe048ddc2af82e` and
  `e45d24345ab4e9d2b87aa91495558b49661156cc`, its Jobs `0011` migration, terminal replay,
  aggregate-only inspection, and required acceptance exercises remain authorized here; any new
  provider activation requires a new review.
- Public route/indexing: prohibited by unchanged false gates.
- Production/candidate/application authority: none.
- Source after the bounded attempt: default recommendation is disabled until public-route and
  source-quality acceptance.
- Correction/takedown owner: pending final D1P acceptance; no public route exists.
- Supersedes: none.
