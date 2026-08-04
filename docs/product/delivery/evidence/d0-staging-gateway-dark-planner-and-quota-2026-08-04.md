# D0-016 staging gateway dark planner and quota evidence

- Date: 2026-08-04
- Environment: Isolated synthetic staging AWS account in `us-east-2`
- Status: Planner source locally verified; staging dark plan blocked by an open AWS quota request
- Runtime change: None
- Terraform plan/apply: None

## Environment-aware planner

The proven development gateway-dark planner is now expressed as one environment-aware operator,
with the original development command retained as a compatibility wrapper. The shared operator:

- selects only `development` or `staging` and derives the exact environment Terraform root,
  profile, resource names, state paths, and output labels from that selection;
- verifies the caller's isolated account and `us-east-2` region;
- requires a clean local `main` whose commit exactly matches its configured upstream;
- verifies the immutable, versioned, customer-KMS-encrypted gateway artifact and its source and
  checksums;
- reconstructs live ECS, database, identity, Temporal, networking, observability, and artifact
  inputs rather than accepting an incomplete hand-built variable set;
- proves the retained gateway and worker ECS services remain at one accepted posture and that the
  API integration does not change;
- permits exactly the eleven dark gateway creates for a first deployment and rejects updates,
  deletions, replacements, unrelated creates, or public traffic changes; and
- retains the already proven guarded partial-recovery, artifact-release, and completed-dark
  verification modes.

The development wrapper now forwards the optional pinned extension layer only when supplied, so a
first dark deployment cannot fail parameter binding on an empty optional value.

Local Windows PowerShell parser checks pass for both scripts. Both help paths pass under Windows
PowerShell, the compatibility wrapper reaches the clean-source gate without an optional layer, and
`git diff --check` plus the full repository `pnpm check` pass. A live Terraform plan is deliberately
not claimed: exact-plan generation is permitted only after this source is merged and the staging
prerequisite below is effective.

## Lambda concurrency prerequisite

A read-only staging account check reported an effective regional Lambda concurrent-executions
quota of `10`. Assigning the reviewed gateway ceiling of `2` must preserve AWS Lambda's standard
unreserved pool of `100`, so the accepted minimum account quota is `102`.

A regional concurrent-executions quota request for `1001` was submitted through AWS Service
Quotas. AWS currently reports it as `CASE_OPENED`; the effective quota remains `10`. This request
does not configure provisioned concurrency, create a Lambda function, or itself run billable
application compute.

The shared planner now enforces this prerequisite for an initial deployment as well as recovery
and verification. It will not create a Terraform plan until the effective quota is at least `102`.

No request identifier, support-case identifier, account number, bucket name, KMS identifier, role
ARN, credential, token, artifact key, endpoint, saved-plan content, or candidate data is retained in
this record.

## Next gate

Wait for AWS to make the quota effective. Then merge and synchronize this planner source, resolve
the exact staging artifact and state inputs without disclosing them, and generate a refresh-backed
staging dark-gateway plan from clean, upstream-matched `main`. Any apply requires separate review
of that generated plan and explicit authorization of its exact SHA-256 checksum.
