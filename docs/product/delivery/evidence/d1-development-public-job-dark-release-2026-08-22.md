# D1 development public-job dark release

Date: 2026-08-22  
Environment: Development  
Status: Complete for the default-off dark release; public activation remains prohibited

## Released boundary

Exact source revision `1fda2f2bff649c1f62437055e140bb9f3a8dd085` was first released through
saved Terraform plan SHA-256
`3a02df4b2b5724f5270656795a41d359f3e06cc8d2657de49fb5295724872306`.
The field-reviewed plan added the separate public edge and private projection functions, aliases,
least-privilege roles, and six alarms; advanced the existing gateway, parser, processor, and
migration-task artifacts; and preserved every activation gate as false. The apply completed with
18 creates, 6 updates, and one immutable migration task-definition replacement. Development state
advanced to serial 117 and migration task revision 13.

The first generated-synthetic direct invocation found a release-blocking Node.js 24
`Runtime.CallbackHandlerDeprecated` error before handler execution. The source handlers were reduced
to the supported two-argument signature, but a version-2 release built directly through the low-level
bundler repeated the failure because it consumed stale compiled output. The owned package build now
compiles the dependency closure first, and the shared artifact builder imports each completed bundle
and rejects any Node.js 24 handler whose exported arity is greater than two. Gateway type-check and
108/108 tests passed, and two package builds were deterministic at edge/projection arity `2`/`2`.

The corrected artifacts are bound to exact clean revision
`7dbb29e8a0fb546fc286c16cae1ff476b021572b`:

- edge SHA-256 `bcc81072f11a89b0a74c96302ff1c84b87e8c5b3a4229370dc9e8f0149123105`,
  Lambda code SHA-256 `vMgQcvEaibCnTJYwL/HIS4foxbOkIpNw3J6PAUkSMQU=`;
- projection SHA-256 `501f5c41ce282f3bc7f7695cefb063a124eccb831f587536bef1f03ff0a2a631`,
  Lambda code SHA-256 `UB9cQc4oLzvH92lc77BjoSTsy4MfWHU2vvHwP/CipjE=`; and
- all ZIP, manifest, SBOM, and checksum objects were published with create-only writes, customer KMS
  encryption, immutable object-version readback, and exact source/hash-qualified keys.

Saved correction plan SHA-256
`dda9be1f1082f868588db2a98b2c8110a0a1102cdcaff8ba140d743e519e08ea` contained exactly four
in-place changes: the two functions and their two aliases. It contained no route, trigger, output,
replacement, or unrelated resource action. The exact plan applied with 0 creates, 4 updates, and
0 destroys, advancing both aliases to version `3` while the route remained absent.

## Runtime and permission correction

Version `3` removed the Node.js callback failure. Its first projection call then failed closed with a
generic unavailable result. Read-only RDS log inspection identified IAM database authentication
failure for the exact no-password database role `ai_job_apply_public_job_reader`. The projection role's
inline `rds-db:connect` permission was correct, but the shared workload permissions boundary omitted
that action. Source already contained a narrowly scoped boundary statement and Terraform regression:

- action: only `rds-db:connect`;
- resource: `arn:aws:rds-db:us-east-2:362544434697:dbuser:*/ai_job_apply_public_job_reader`; and
- consumer: the existing development workload boundary, without password or broader database access.

Bootstrap saved plan SHA-256
`405706be6c6b3f950795ef58b721b39a7f0307e2172b23ec352385daba81e3cd` updated only that managed
policy, from 13 to 14 statements. The exact plan applied with 0 creates, 1 update, and 0 destroys.
The live policy is now version `v7`, contains exactly one matching reader-connect statement, and IAM
simulation for the projection role and exact database-user resource returns `allowed`.

The exact one-shot migration task revision `13` also ran without overrides in the private subnets,
with public IP disabled, and exited `0` using scanned immutable migration image
`sha256:f56e253f54b62c359ddbe8edc8196d7c6c06916d58e400520da9e42372453a43`.
The cluster returned to zero tasks.

After the boundary apply, direct generated-synthetic dark invocation passed end to end:

- projection alias version `3` returned exact `{ "kind": "absent" }` for an absent synthetic UUIDv7;
- edge alias version `3` executed successfully and returned HTTP `404`, code
  `PUBLIC_JOB_NOT_FOUND`, and `cache-control: public, max-age=0, must-revalidate`; and
- no public API Gateway route was created or invoked.

## Final verification

Refresh-backed zero-drift plans are clean:

- development plan SHA-256
  `08243d3f66e3a679a8cf1b2194468df6a29bad038184b52abf1fcb0f522aa7ca`:
  zero resource changes and zero output changes; and
- bootstrap plan SHA-256
  `8d3d5842997d6f76da3d8e354bb3ebde7e8d11173f2918f83404707ece7aaa46`:
  zero resource changes and zero output changes.

Final live inspection at development state serial `119` established:

- gateway alias `20`, parser version `3`, processor alias `3`, and public aliases `3`;
- both public functions `Active`/`Successful`, with exact code hashes and no weighted routing;
- zero VPC subnets, zero security groups, and zero database environment names on the edge;
- exactly two private subnets and one application security group on the projection;
- zero matching public API routes;
- document scan rule `DISABLED` and document event-source mapping `Disabled`;
- ingestion runtime and synthetic source disabled/undeployed;
- zero active ECS tasks; and
- all six public edge/projection alarms in `OK`.

This evidence completes only the safe, default-off D1-009 dark deployment and its runtime/isolation
acceptance. It does not authorize or claim public routing, crawling/indexing, `JobPosting` JSON-LD,
real source or candidate data, legal/source approval, representative abuse/load acceptance, or Phase 1
completion.
