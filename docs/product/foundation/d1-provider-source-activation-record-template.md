# D1 Provider Source Activation Record Template

- State: template only; no source authority
- Governing decision: [ADR-025](../../adr/025-public-ats-feed-activation-governance.md)
- Scope: one exact Greenhouse, Lever, or Ashby public GET configuration

Copy this template into a dated evidence record only after the default-off production preflight
passes for exact repository-owner-supplied values. Replacing `Pending` fields is necessary but does
not itself activate a source. The final record must be attributable and merged before any plan may
set provider authority, runtime, schedule, mapping, or the source's `enabled` field to true.

## Record identity

| Field | Exact value |
|---|---|
| Record ID | Pending |
| State (`Draft`, `Accepted`, `Expired`, or `Superseded`) | `Draft` |
| Created at (UTC) | Pending |
| Accepted at (UTC) | Pending |
| Environment/account/region | Pending |
| Exact repository commit | Pending |
| Accountable product/source owner | Pending |
| Authorized operator and temporary-role identity | Pending |

## Exact source configuration

| Field | Exact value |
|---|---|
| Provider (`greenhouse`, `lever`, or `ashby`) | Pending |
| Stable source ID | Pending |
| Company display name | Pending |
| Verified company domain | Pending |
| Greenhouse board token | Not applicable or Pending |
| Lever site | Not applicable or Pending |
| Lever region (`global` or `eu`) | Not applicable or Pending |
| Ashby job-board name | Not applicable or Pending |
| Adapter version | Pending |
| Configuration SHA-256 | Pending |
| Provenance | `permitted_api` |
| Default-off preflight result/evidence | Pending |

The record must contain exactly one provider-specific identifier family. It must not contain a
credential, private token, arbitrary URL, candidate datum, provider response body, compensation,
unlisted job, or application-submission authority.

## Immutable release boundary

| Field | Exact value |
|---|---|
| Migration image digest and immutable version | Pending |
| Ingestion artifact SHA-256/version IDs | Pending |
| Numeric unweighted coordinator/starter/activity/terminal versions | Pending |
| Numeric durable version | Pending |
| Reviewed Terraform plan SHA-256 | Pending |
| Baseline state serial/plan SHA-256 | Pending |
| Expected changed-resource allowlist | Pending |
| Rollback/restoration plan SHA-256 | Pending |

## Bounded operating contract

| Control | Accepted exact behavior |
|---|---|
| Acquisition | Provider-published unauthenticated fixed-host GET only |
| Reconciliation cadence | Every five minutes, producing at most one idempotent hourly occurrence |
| Request deadline | Five seconds |
| Maximum response | 1,000,000 bytes |
| Maximum accepted observations | 100 per occurrence |
| Redirects/alternate hosts/ports/caller URLs | Refused |
| Credentials/application POST/private APIs | Prohibited |
| Egress | Private NAT only while provider authority is true |
| Telemetry/evidence | Aggregate identifiers/counts/statuses only; no response bodies |
| Failed or empty poll | Does not prove withdrawal and does not close jobs |
| Positive revalidation/removal | Required; provider-specific exact behavior linked below |
| Pause | Exact source ID + adapter version + configuration SHA-256; no resume operation |
| Reactivation after pause | New configuration/activation record only |

Provider-specific evidence must link the exact URL-identity, canonicalization, provenance,
revalidation, withdrawal, and public-truth checks. Ashby evidence must exclude `isListed: false`;
Greenhouse and Lever must retain their deliberately unclassified original-publication semantics.

## Activation and acceptance sequence

Each item remains false until its evidence exists.

| Gate | State | Evidence |
|---|---:|---|
| Repository-owner exact company/board choice recorded | false | Pending |
| Default-off production preflight passed | false | Pending |
| Accountable product/source owner accepted this exact record | false | Pending |
| Immutable artifacts published and independently read back | false | Pending |
| Saved Terraform plan stays inside the reviewed boundary | false | Pending |
| Provider authority/source/runtime activation applied | false | Pending |
| Bounded provider request and provenance passed | false | Pending |
| Canonical persistence/deduplication/public truth passed | false | Pending |
| Positive revalidation/removal and failed-poll safety passed | false | Pending |
| Exact persisted pause prevented new work | false | Pending |
| Exact fixture/provider-data cleanup or approved retained rows verified | false | Pending |
| Alarms/queues/tasks/log-redaction checks passed | false | Pending |
| Default-off restoration and zero drift passed | false | Pending |
| Product/source owner accepted residual source-quality findings | false | Pending |

## Disposition

| Field | Exact value |
|---|---|
| Final decision | `Not accepted` |
| Scope authorized | None |
| Source remains enabled after acceptance | Pending; default recommendation is false until public-route decision |
| Revalidation/expiry | Pending |
| Correction/takedown owner and channel | Pending |
| Findings/conditions | Pending |
| Supersedes record | None |
| Attributable acceptance reference | Pending |

An `Accepted` record authorizes only its exact configuration and environment. Any company/domain,
board/site/name, region, adapter version, configuration digest, field-use, cadence, provider,
endpoint, or environment change requires a new record.
