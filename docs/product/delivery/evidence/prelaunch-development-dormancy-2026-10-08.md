# Development billing and data-preserving shutdown — 2026-10-08

Development shutdown is deployed and independently verified. The initial staging access denial was resolved later on 2026-10-08; see the final staging verification below.

## Billing finding

Finalized development costs rose from $79.74 in August to $151.27 in September. EC2-Other
rose from $6.62 to $61.83, principally NAT gateway availability: 147 versus 1,374 hours.
VPC charges rose from $38.48 to $57.27, including interface endpoints and public IPv4.
The additional provider network was created September 3, following the application NAT on
August 25. These were valid metered infrastructure charges, but leaving test infrastructure
provisioned between sessions caused avoidable cost. October 1–7 was already an estimated $33.58.
The removed networking represented approximately $4.08/day ($122.40 per 30 days) at the observed
rates. A $5 budget existed without automatic actions; an alert alone did not stop resources.

## Deployed evidence

Networking shutdown from #568 was verified before the database-only follow-up. A current encrypted
safety snapshot restored successfully to an isolated, private PostgreSQL instance with the same
KMS key. AWS reported the restored instance available. This verifies physical RDS restore readiness;
SQL correctness, application acceptance and privacy replay were not exercised.

The exact preparation plan changed only the original database protection/final-snapshot settings.
The exact dormant plan removed only that database, created an encrypted final snapshot, and
retained automated backups. After the final snapshot was available, the temporary restore instance
was removed. Both safety and final snapshots remain available. Database compute can no longer
restart automatically after seven days because neither database instance exists.

Final readback: zero RDS instances, nondeleted NAT gateways, allocated Elastic IPs, paid interface
endpoints, running/pending EC2 instances and EBS volumes. Two S3 gateway endpoints remain.
Project API routes, EventBridge schedules and queue consumers are disabled; queues are empty and
no project ECS tasks or durable workflows are running. The security-managed GuardDuty rule remains.

Terraform state serial 417 retains 283 managed resource identities. Comparing pre/post state found
only the database identity removed; no other identity changed. The final exact-input dormant plan
reported no changes. A future restore plan passed the operator's scope guard and was **not applied**.
Full dormant inputs and restore proof were uploaded to versioned, KMS-encrypted Terraform-state
storage, then read back by version and verified byte-for-byte. Private inputs, state and proofs are
excluded from Git. Follow the [recovery runbook](../../../../infrastructure/runbooks/deployments/development-database-dormancy.md).

| Artifact | SHA-256 |
|---|---|
| Applied preparation plan | `a6e0ac22e16464added63412b520144926f82c8e8a3c099e0255e4d3cf43a243` |
| Applied dormant plan | `7c1884146244ee866e67bea6ea4500462a04116c6243ecea84e355505051e047` |
| Final no-change plan | `355e041877d425eb47e964a95c62e1b8e8cd1b0aab1c953425a28aab4ddf937e` |
| Archived dormant inputs | `56837d6d43421236c9a47233ff522772a2be0d87b4970c32d6d16efb7db227f4` |

## Validation and limits

Terraform 1.16.2: full platform suite 227 passed, followed by five focused lifecycle tests after
adding the fifth restore case; 17 offline operator scope checks passed. Terraform format and
bootstrap/development/staging validation passed. No application/UI changes or Docker startup.
Source is reviewed through [PR #570](https://github.com/Vrixic/project-ai-job-apply/pull/570).
Hosted checks did not start because GitHub reported account payment/spending-limit restrictions;
no hosted test result is claimed and no billing limits or CI configuration were changed.

Retained snapshots/automated backups, S3 objects, ECR images, KMS keys, Secrets Manager secrets,
logs/alarms and DNS may continue incurring charges. This is not a zero-cost claim. Already accrued
October costs remain payable. Staging verification was initially blocked by account assignment; the final evidence below closes that blocker.

## Staging access restored and dormancy verified — 2026-10-08

The owner corrected the account assignment. After explicit SSO logout and fresh authentication,
STS confirmed the expected staging account. Independent live reads in us-east-2 at approximately
19:40 UTC found zero RDS instances, NAT gateways, allocated Elastic IPs, VPC endpoints, EC2
instances or EBS volumes. The retained ECS cluster has zero running/pending tasks and zero services.
There are zero API routes, enabled application EventBridge rules, EventBridge Scheduler schedules
or running profile-readiness durable executions. The outbox mapping is Disabled. All three project
queues have aggregate visible, in-flight and delayed depth zero. No cloud mutation was necessary.

The legacy lifecycle Status helper could not finish: it inferred an optional document processor
from a successful empty event-mapping response, then required that absent feature's event rules.
No lifecycle Status success or fresh Terraform drift plan is claimed. Direct successful AWS reads
enumerated all functions, mappings, rules, routes and project queues independently; the deployed
function inventory does not contain a document processor.

The repository cost operator also passed `-VerifyDormantStaging` for 2026-10-07 through 2026-10-08
(exclusive): zero RDS instance-hours and zero VPC endpoint-hours. Estimated total was $0.1228,
principally KMS $0.0645, CloudWatch $0.0452 and Secrets Manager $0.0129, with small ECR/S3 charges.
The $5 budget and export controls remain present; the CUR export is healthy. Retained security,
monitoring and storage costs are intentional; this is not zero cost.

OPS-003's access/verification blocker is closed. At the owner's request, AWS SSO was explicitly
logged out after this verification and a fresh development login was initiated. No runtime was
reactivated. The development lifecycle implementation in PR #570 is now merged.

## Repeated development shutdown after interrupted testing — 2026-10-08

A later test session restored development's database, then lost its own network/write access before
cleanup. A fresh live check found the database available again. The owning session confirmed no
active test/apply and no SQL execution, and transferred exclusive cleanup ownership. The earlier
shutdown evidence remains historical; this entry records the new final state.

At approximately 20:34 UTC, independent AWS reads confirm **zero RDS instances**, including the
original and temporary restore check; zero NAT gateways, allocated Elastic IPs, paid interface
endpoints, EC2 instances and EBS volumes. The lifecycle drain checks passed before planning and
applying: no application routes, enabled schedules/queue mappings, project ECS tasks or running
durable workflows, and empty queues. Development SSO remains signed in for subsequent work;
authentication does not reactivate runtime capacity.

The latest full inputs from state 424 were reconciled with actual restored database metadata.
Only database lifecycle mode/recovery metadata changed; the original restore-snapshot binding and
all feature inputs were preserved. A new encrypted safety snapshot physically restored to a private,
available database with matching KMS key. The exact preparation plan changed only deletion
protection and the new final-snapshot name. The exact dormant plan removed only the database,
required an encrypted final snapshot and retained automated backups. After the final snapshot was
available and the original absent, the exact temporary restore instance was removed. This was
physical RDS recovery verification, not SQL/application/privacy acceptance.

State advanced **424 -> 427**. Identity comparison found only the database removed, with all
**289 other managed resource identities unchanged**. The final exact-input plan reports
**No changes**. Versioned KMS-encrypted recovery inputs, restore proof and manifest were refreshed
and checked by exact-version byte readback; older snapshots and archive versions remain retained.
The existing recovery runbook applies to the new final snapshot. Storage/security costs remain.

| Artifact | SHA-256 |
|---|---|
| Applied preparation plan | `8a283b5b58cd30e8c437a590c68fa7a8060cf02e1d820e85932c102094184ec2` |
| Applied dormant plan | `e6c9decb1c2cf6d1ea81f020a93607af1feab4bc83ad8cf3537daa20eb0df239` |
| Final no-change plan | `4649fc673735d9ed8ef9f91bef8ee957df1443e01dcc389002e5ab41949a1f8f` |
| New archived dormant inputs | `39745c94c1dcb0933ead6ac40881556374d89e2e172b154b569161daa7a29a29` |

The other session was notified that the database cleanup warning is resolved and that reactivation
requires a subsequent authorized testing session, followed by the same mandatory shutdown gate.
