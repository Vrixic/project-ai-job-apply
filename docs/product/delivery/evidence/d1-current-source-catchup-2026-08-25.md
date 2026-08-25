# D1 current-source catch-up — 2026-08-25

## Disposition

Exact implementation revision `2f1678883b3e489b78fe08cb7853f313dad0602c` completes three remaining
locally implementable Phase 1 foundations without activating a public surface or claiming an
external decision:

- a default-dark canonical public-job sitemap feed, Jobs-owned projection, isolated edge handling,
  request-time Next sitemap, migration `0013_public_job_sitemap`, alarms, restore composition, and
  local immutable public-reader artifact publisher;
- a fail-closed generated-synthetic candidate-rights acceptance operator and runbook; and
- a no-default, aggregate-only representative D1 assurance configuration, assessor, and runbook.

All work was integrated directly on shared `main`. The three assigned agents created no branches,
commits, or cloud mutations; the primary agent reviewed, reconciled, tested, and committed their
disjoint changes as one source candidate.

The first exact-current workflow publication invocation then exposed a wrapper-only PowerShell
binding defect before any workflow object was written: empty optional checksum/path parameters had
been forwarded explicitly to validated engine parameters. Exact correction
`bec803cae0dd8c0e1d6c90da0745ac6f868b068a` conditionally forwards all three optional values in both
the workflow and public-job wrappers. PowerShell 7 and 5.1 regressions pass for both wrappers. The
earlier gateway publication remains immutable but is superseded for final-source provenance; it
did not deploy anything.

## Verification

- API contracts: 37/37.
- Jobs unit: 71/71.
- Gateway: 117/117.
- Candidate web: 42 files and 527/527 tests, typecheck, and production build including dynamic
  `/sitemap.xml`.
- Database restore verifier: 35/35.
- Platform Terraform: 38/38, including the exact `0013_public_job_sitemap` database boundary and
  default-absent routes.
- PowerShell 7 and Windows PowerShell 5.1 focused guards pass for candidate rights and
  representative assurance. The public-job publisher guard passes under both hosts.
- The isolated public-job edge/projection build produced separate artifacts; infrastructure
  validation, including all repository-owned operator guards, passes.

The repository-wide format command continues to report only four pre-existing unmodified
`skills/frontend-design/scripts/*.mjs` files. All files in this source candidate pass targeted
Biome checks and `git diff --check`.

## Safety boundary

The sitemap returns no URLs and performs no API request unless indexing is explicitly enabled.
The API Gateway detail and sitemap routes share the existing complete public-publication gate and
remain absent by default. The public database identity retains execute-only access to fixed
security-definer functions and no Jobs table access. No Indexing API integration exists.

The later policy/preprovision record supersedes this packet's candidate-rights decision state: the
policy/version/digest, timings, 35-day backup disposition, owners, and executable-adapter inventory
are selected, and Stage A is applied at state `204` with zero drift. Execution still requires an
authorized non-Zach managed Auth0 M2M credential, one disposable generated-synthetic recent-MFA
identity, Stage B, and separate quiesced-restore replay evidence. The representative assessor accepts no default SLO or alert
recipient values and deliberately refuses execution until a guarded generated-synthetic provider
fault/recovery fixture exists.

## Superseding deployment disposition

The planned engineering sequence is complete. Exact release source
`9abcebb5c2577d09b789ad74be1bb7ee51a891e6` was immutably published, applied default-dark, migrated
once through the 26-migration/45-relation boundary, verified across aliases, alarms, queues, routes,
and zero drift, and recovered through a clean isolated PITR exercise. Follow-up guard correction
`041e4320bc47c614f52aa2fd5f0209da23418e3e` is merged and verified. See the
[current dark release, migration, and recovery](d1-current-dark-release-migration-and-recovery-2026-08-25.md).

Vercel and accountable product, accessibility, security/privacy, moderation, source-quality,
candidate-rights deployed lifecycle/replay, representative SLO, alert-recipient, and safe
provider-fault-fixture decisions remain. Phase 1 is not complete, and every affected activation
gate remains false.
