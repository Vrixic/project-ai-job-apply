# Development billing and data-preserving shutdown — 2026-10-08

Development shutdown is deployed and independently verified. Staging verification remains blocked
by `GetRoleCredentials: ForbiddenException: No access` after fresh SSO authentication.

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
October costs remain payable. Staging's current resources cannot be independently enumerated until
its AWS account assignment is restored; that mandatory verification remains incomplete.
