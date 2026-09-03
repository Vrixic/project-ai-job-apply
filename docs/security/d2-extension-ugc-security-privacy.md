# Phase 2 Extension and UGC Security/Privacy Delta

- Status: Engineering design; accountable approval pending
- Last updated: 2026-09-03
- Decision boundary: [ADR-028](../adr/028-extension-ugc-ownership-and-processing.md) and
  [ADR-029](../adr/029-one-step-public-job-addition.md)

This is the single D2 engineering delta for the extension, contribution, and community trust
surface. It authorizes synthetic/default-dark implementation only. It does not approve real
candidate use, public contribution, provider-derived fixture capture, or browser-store
distribution.

## Minimum data flow

```text
explicit current-tab action
  → local provider detector and strict field sanitizer
  → candidate preview and field removal
  → explicit Add job to shared database command
  → extension background session + bounded pending queue
  → authenticated gateway (`jobs:contribute`)
  → Jobs atomic queued intake + identifier-only outbox
  → source-safe normalization and independent verification
  → Trust review when required
  → accepted catalog observation or rejected/removed state
```

The normal path stores no raw DOM or page snapshot. Allowed contribution values are the canonical
source URL and selected structured public fields needed to identify and verify the posting. URLs
must use HTTPS, remove credentials/fragments/tracking parameters, reject local/private/link-local
targets, and match an enabled supported provider/domain rule. Text must be bounded, normalized,
free of markup/control characters, and never interpreted as instructions.

## Data classification and ownership

| Data | Classification | Owner | Required behavior |
|---|---|---|---|
| Selected job fields and canonical public URL | Public before submission; Internal while pending | Jobs | Strict allowlist, digest binding, source-safe verification |
| Contributor association and contribution status | Confidential | Jobs for owner-scoped command/status | Never public or placed in events/telemetry |
| Command-authorization record and policy version (v1 API name: contribution consent) | Confidential | Profile | Immutable, exact payload digest, revocable before publication; not presented as permission to read a public page |
| Reputation, sanctions, takedown, withdrawal, appeal | Confidential/Internal | Trust | Private, appealable, human-controlled where policy requires |
| Pending extension intent | Confidential local device data | Extension client | Minimum fields, bounded retention, account fencing, clear on acknowledgement/withdrawal |
| Authorized provider fixture raw capture | Restricted evidence outside Git | QA/security evidence owner | Encrypted quarantine, access audit, maximum 30 days, disposition evidence |

## Threats and required controls

- **Over-permission or browsing surveillance:** no `history`, `cookies`, broad `webRequest`, or
  `<all_urls>` permission; use explicit `activeTab` or narrow optional hosts and disclose each use.
- **Token theft:** public-client PKCE, short-lived access tokens, rotating refresh tokens confined to
  trusted extension session storage, exact sender validation, logout/revocation, and no token logs.
- **Malicious page/UGC:** strict structured extraction, local and server validation, no executable
  page content, bounded values, safe URL policy, output encoding, verification, moderation, and
  rate/abuse controls.
- **Provider truth corruption:** separate append-only UGC evidence, explicit precedence, no
  activation/freshness refresh before independent verification, and conflicts routed to review.
- **Cross-user replay:** owner-scoped semantic UUID plus request digest and idempotency key; status,
  withdrawal, and appeal enforce the authenticated owner.
- **Offline duplication or account mix-up:** durable local state machine, stable keys, bounded
  retry, timeout-after-commit replay, and logout/identity-change fencing.
- **Ambiguous destination or duplicate approval:** one labelled public-add command after the exact
  field preview; no private-save control or second approval checkbox in this extension candidate.
- **Contributor exposure:** contributor identity and reputation absent from catalog responses,
  events, logs, analytics, public moderation summaries, and other contributors' views.
- **Remote-code/update abuse:** no remote executable code; versioned signed package/config data,
  reproducible bundle inspection, minimum CSP, and version/domain kill switches.
- **Store/disclosure mismatch:** generated manifest permissions must match the reviewed disclosure,
  privacy statement, screenshots/copy, network behavior, and final archive.

## Retention and deletion

- Normal contributions retain zero raw page snapshots.
- Pending device intents are removed after acknowledged terminal handling or after 24 hours. The
  product owner selected this minimum practical offline-retry window for the Phase 2 candidate on
  2026-09-03; accountable security/privacy acceptance remains required before real use.
- Sanitized contribution records follow the approved lifecycle; removed/expired records retain only
  a minimal non-PII integrity/deduplication tombstone.
- Contributor associations participate in authenticated export/deletion and contribution
  withdrawal. Restores must replay deletion/withdrawal ledgers before serving.
- The 30-day raw-contribution quarantine value applies only to separately approved external fixture
  evidence. It is a maximum, not a normal product retention target or public promise.

## Release gates

The following remain blocking and cannot be self-certified by repository implementation:

1. LR-D2-01 contribution license, provenance, contributor privacy, takedown, withdrawal, appeal,
   and repeat-abuse disposition.
2. LR-D2-02 extension permissions, browsing-data disclosure, privacy statement, and store-policy
   disposition.
3. Accountable D2 security/privacy acceptance of the exact data flow, controls, retention,
   subprocessors, telemetry, and deployed candidate.
4. Authorized Greenhouse, Lever, and Ashby fixtures with capture authorization, scans, human
   sanitization review, independent QA representativeness acceptance, and raw disposition.
5. Dedicated extension Auth0 Native Application plus Chrome and Edge PKCE, refresh rotation/replay,
   cancellation, logout, and revocation evidence.
6. Final archive permission/CSP/remote-code/secret inspection, accessibility and malicious-UGC
   browser tests, default-dark deployment, rollback, restore, load/abuse, alerts, and kill-switch
   evidence.

Until all applicable gates pass, provider detection, contribution intake/processing, and store
distribution remain disabled and shared environments remain synthetic-only.
