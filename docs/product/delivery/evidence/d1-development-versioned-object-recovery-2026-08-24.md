# D1 development versioned-object recovery — 2026-08-24

## Outcome

The generated-synthetic development object-recovery exercise is accepted. One exact clean PDF
version was service-scanned by GuardDuty, hidden by an exact S3 delete marker, recovered from its
descriptor-bound prior version, written as a new checksum/KMS/metadata-bound version, and
service-scanned clean again. The marker and superseded version were removed, the restored version
was proved current, and final owner-safe cleanup left zero database rows and zero object history.

Every downstream document trigger remained disabled. No real candidate data, EventBridge/SQS
delivery, event-source mapping, reconciler, processor/parser activation, API Gateway/JWT behavior,
cross-region recovery, RTO, or RPO is claimed.

## Bound execution

- Deployed application source: `eb617045e98a0a5db70f0b6250e27d0d6102622b`.
- Recovery operator source: `a0fc39a0c62b5c1ca23d6a538f9820f241ea0154`.
- Terraform state serial before and after: `190`.
- Execution-plan SHA-256:
  `fa4668092cc2c5cb371fa108be427547c808e482b4e6ab14c174d99f19022202`.
- Generated fixture-set SHA-256:
  `1024f2969981892482b101c165ff912307e13176b0ca113d7b8d9563e46cb1ab`.
- Ignored receipt SHA-256:
  `7be7c093ed7a8c5e3836876e06e457422a6be7ac68f15afd52a07608a1007d07`.
- Protection plan status/tagging: `ACTIVE` / `ENABLED`.
- Managed clean scan results: `2`.
- Prior-version recovery: `true`.
- Delete-marker recovery: `true`.
- Restored-version managed rescan: `true`.
- Superseded-version cleanup: `true`.
- Persistent generated rows after cleanup: `0`.
- Exact generated object history after cleanup: `0`.
- Trigger activation: `false`.
- Real candidate data: `false`.

The ignored execution descriptor, receipt, durable claim/recovery descriptor, generated identities,
bucket/key/version identities, account/resource identities, and fixture bytes remain local.

## Independent post-run checks

- GuardDuty result rule: `DISABLED`.
- Document scan mapping: `Disabled`.
- Document reconciler rule: `DISABLED`.
- Result queue, scan DLQ, and delivery DLQ: zero visible, in-flight, and delayed messages.
- Document alarms: `8/8` `OK`.
- All current D1 alarms during the refresh-backed preflight: `44/44` `OK`.
- ECS tasks: `0`.
- Disposable database restore targets/context: `0` / absent.
- Terraform drift: `0` changes.
- Docker processes and running WSL distributions: `0` / `0`.

## Verification

The focused document operator suite passes under PowerShell 7 and Windows PowerShell 5.1. The
complete `pnpm infrastructure:validate` suite passes, including serverless, document, gateway,
migration, catalog, job-search, and restore guards. `git diff --check` passes.

## Remaining recovery boundary

This closes same-region S3 version/delete-marker recovery for generated D1 document data. The
separate PostgreSQL PITR create/verify/cleanup exercise remains explicitly mutation-gated. Real
candidate deletion/export/restore reconciliation and accountable privacy/security acceptance remain
part of the final stable-candidate decision set.
