# D0 Staging Activation Guard Hardening — 2026-08-10

## Disposition

The first dormant-to-active preflight stopped without AWS mutation after plan review identified a
reusable operator-policy weakness. The generated plan itself was dark and contained only the
expected eight disposable-resource creates plus one operations-dashboard update. However, the
active-mode validator rejected deletes without enforcing the exact allowed create/update set.

The saved pre-hardening plan and metadata were removed from the ignored local lifecycle directory.
It is not eligible for approval or apply. A fresh plan must be generated from merged hardened
source.

## Read-only preflight result

The lifecycle operator first reconfirmed the deployed boundary:

```json
{
  "Environment": "staging",
  "Mode": "dormant",
  "DatabasePresent": false,
  "DatabaseDeletionProtection": false,
  "ManagedInterfaceEndpoints": 0,
  "PublicRuntimeRoutes": 0,
  "EnabledEventMappings": 0,
  "EnabledEventRules": 0,
  "AggregateQueueDepth": 0
}
```

The discarded refresh-backed plan contained:

- eight creates: encrypted private RDS, its current secret version, three private-DNS interface
  endpoints, the migration task definition, and two database alarms;
- one dashboard update from the dormant placeholder to the recreated database metric identifier;
- zero deletes, replacements, routes, event-source mappings, or EventBridge-rule changes; and
- RDS deletion protection enabled, seven-day backup retention, encrypted storage, and no public
  accessibility.

`skip_final_snapshot=true` is intentional for synthetic staging under ADR-018. Active deletion
protection and seven-day backups protect the bounded exercise; the lifecycle never retains a final
synthetic staging snapshot.

## Correction

The lifecycle operator now fails closed on exact transition semantics:

- quiescence requires the protected database to become unprotected and requires the exact mapping
  plus both EventBridge rules to move from enabled to disabled;
- dormancy permits exactly eight known disposable-resource deletes plus one dashboard update and
  rejects every other action; and
- activation permits exactly the inverse eight creates plus one dashboard update, requires an
  encrypted non-public deletion-protected database with at least seven days of backups, and requires
  exactly three private-DNS interface endpoints.

Repository infrastructure validation now requires these guards to remain present.

## Verification

- PowerShell parser and operator help path: passed.
- `git diff --check`: passed.
- `pnpm check`: passed, including skills validation, infrastructure policy, formatting, lint,
  type checking, and tests.
- AWS mutation: none.

After merge, generate a new exact-main activation plan and require its new checksum approval before
creating any charge-bearing staging resource.
