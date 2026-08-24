# D1 Ashby Linear development activation record — 2026-08-24

- Record ID: `D1-ATS-DEV-2026-08-24-01`
- State: `Accepted for bounded development planning`
- Governing decision: [ADR-025](../../../adr/025-public-ats-feed-activation-governance.md)
- Environment: development, repository-bound AWS account, `us-east-2`
- Exact repository commit at acceptance: `38ec7e97e54d05870aafc43d092ad0c407bdeed3`
- Created and accepted at: `2026-08-24T07:03:49Z`
- Accountable product/source owner: Vrij, repository owner
- Authorized operator: Vrij through a temporary development IAM Identity Center administrator
  session

## Authority and boundary

The repository owner instructed engineering to use its recommended first provider and proceed,
after explicitly removing separate Phase 1 legal approval for Greenhouse, Lever, and Ashby. This
record selects the smallest suitable recommended source: Linear's public Ashby board. It authorizes
only a bounded development plan for the exact configuration below. It does not authorize an apply
until the saved plan identity and allowlist are inserted into this record and reviewed.

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
| Activation plan SHA-256 and allowlist | Pending; apply prohibited |
| Restoration plan SHA-256 | Pending; apply prohibited |

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

## Activation and acceptance sequence

| Gate | State | Evidence |
|---|---:|---|
| Repository-owner provider recommendation and proceed instruction | true | Active implementation instruction |
| Exact public company/domain/board verified | true | Official public Ashby response |
| Default-off production preflight | true | Exact safe descriptor above |
| Accountable owner accepted bounded planning | true | This record |
| Immutable dark artifacts/readback | true | Existing provider-capable dark-release evidence |
| Saved plan inside reviewed activation allowlist | false | Pending |
| Plan identity inserted and apply accepted | false | Pending |
| Provider authority/source/runtime applied | false | Pending |
| Bounded provider request/provenance | false | Pending |
| Canonical persistence/deduplication/public truth | false | Pending |
| Positive revalidation/removal and failed-poll safety | false | Pending |
| Exact persisted pause blocks new work | false | Pending for this live source |
| Retention or exact cleanup disposition | false | Pending |
| Alarms/queues/tasks/log redaction | false | Pending |
| Default-off restoration and zero drift | false | Pending |
| Product/source-quality residual acceptance | false | Pending |

## Current disposition

- Decision: exact default-off configuration and bounded plan preparation accepted.
- Apply authority: none until this record contains the reviewed saved-plan SHA-256, plan metadata,
  expected resource allowlist, and explicit apply acceptance.
- Public route/indexing: prohibited by unchanged false gates.
- Production/candidate/application authority: none.
- Source after the bounded attempt: default recommendation is disabled until public-route and
  source-quality acceptance.
- Correction/takedown owner: pending final D1P acceptance; no public route exists.
- Supersedes: none.
