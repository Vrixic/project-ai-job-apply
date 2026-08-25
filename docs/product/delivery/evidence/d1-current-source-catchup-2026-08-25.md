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

Candidate-rights execution still requires attributable policy/version and timing decisions,
backup-inventory/aging disposition, an authorized non-Zach managed Auth0 M2M credential, one
disposable generated-synthetic recent-MFA identity, a reviewed zero-drift release, and separate
quiesced-restore replay evidence. The representative assessor accepts no default SLO or alert
recipient values and deliberately refuses execution until a guarded generated-synthetic provider
fault/recovery fixture exists.

## Remaining sequence

The next engineering sequence is immutable exact-current artifact publication, an application-only
default-dark Terraform release, runtime/alias/alarm/queue/zero-drift verification, a separately
planned migration-task update, exactly one migration run, and a final public-reader dark release.
Vercel and accountable product, accessibility, security/privacy, moderation, source-quality,
policy, SLO, and alert-recipient decisions remain at the end. Phase 1 is not complete.
