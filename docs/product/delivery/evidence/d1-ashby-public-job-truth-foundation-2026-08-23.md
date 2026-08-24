# D1 Ashby public-job truth foundation — 2026-08-23

## Outcome

Current source can carry provider-original publication time, an exact employer application URL,
and structured physical job locations from a reviewed Ashby public job-board response through the
ingestion worker, Jobs persistence, isolated anonymous projection, generated API contract, and
canonical Next job page. Complete on-site or hybrid projections emit guarded `JobPosting` JSON-LD;
incomplete or remote projections emit none. The page may show the exact external application link,
but does not submit an application or claim confirmation.

Migration source `db6fe0b1682da0a69d2a2aeb8a28d1655b5060df` is merged on `main`. Its
nineteen-migration image was built twice reproducibly for Linux/AMD64, runtime-smoked, immutably
published, read back, and scanned `COMPLETE` with zero High/Critical findings. A checksum-bound
Terraform plan changed only the idle migration task definition, advanced development to state
serial `150` and task revision `39`, and a single no-override Fargate task applied and verified Jobs
`0010_public_job_truth_fields`. The task exited `0`, emitted exactly six aggregate migration success
markers, and returned the retained cluster to zero tasks and zero services. A fresh refresh-backed
plan then proved zero drift with provider authority, provider sources, ingestion runtime, synthetic
source, public route, and indexing disabled.

The first affected dark Lambda release advanced ingestion and public runtimes without enabling a
route or trigger. Live verification then found that the public edge's defensive parser and response
projection had not yet allowlisted/carried the new optional truth fields. The route was absent, so
no user traffic was affected. Correction source `d2586e4628f024b89bf05ad3494a6c335034ebc1`
adds exact validation and response projection for work mode, employment type, provider publication
time, HTTPS application URL, and structured physical addresses. All 108 Gateway cases and Gateway
typecheck pass. Its edge/projection ZIPs built twice reproducibly, were immutably published with
all sidecars and exact-version customer-KMS readback, and a saved four-update/zero-delete plan
advanced only the two functions and two unweighted aliases. Final development state is serial `154`
with both public aliases at version `5`. Direct projection returns exact absence; direct
edge-to-projection returns the canonical cache-bounded `404`; the public route count is zero; all six
public alarms are `OK`; ECS is idle; and the final refresh-backed plan is zero drift. No provider
request/data, real job, real candidate, or application occurred.

## Source semantics

- The [Ashby public job posting API](https://developers.ashbyhq.com/docs/public-job-posting-api)
  documents `publishedAt`, `jobUrl`, `applyUrl`, workplace type, and structured address fields. The
  adapter validates those values against the configured board and exact posting identity.
- The [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html) exposes an update
  time, not a field this platform can truthfully classify as the employer-original publication
  date. Greenhouse therefore does not populate `datePosted` in this source.
- The [Lever Postings API](https://github.com/lever/postings-api) does not establish a reliable
  original-publication field in its supported public contract. Lever therefore does not populate
  `datePosted` in this source.
- Google’s [JobPosting structured-data guidance](https://developers.google.com/search/docs/appearance/structured-data/job-posting)
  requires truthful publication and location semantics. A physical employer address is not treated
  as proof of remote-applicant eligibility, so this source suppresses remote-job JSON-LD.

## Implemented boundary

- Jobs domain and source contracts validate bounded provider date, HTTPS application URL, and one
  to twenty country-bearing structured locations.
- The Ashby adapter requires an exact board-owned application path, a strict ISO publication
  timestamp, and bounded structured addresses; foreign or malformed values fail the source attempt.
- Jobs migration `0010` adds optional source/canonical fields and recreates only the allowlisted
  `jobs_public.read_public_job_detail(uuid)` projection. Existing rows remain valid.
- Canonical persistence keeps the earliest observed provider publication time and does not erase
  already-grounded public truth when a later exact observation omits optional fields.
- The public reader rejects malformed chronology, URLs, locations, and enums before projection.
- The Next page emits JSON-LD only when publication time, application URL, structured location, and
  on-site/hybrid semantics are all present. It escapes `<` in the serialized JSON and preserves the
  default `noindex`/crawler-denial posture.
- The restore manifest now contains five contributors, eight declared schemas, forty-two relations,
  and nineteen migrations through Jobs `0010`.

## Verification

- API contracts: 32/32.
- Domain schemas: 5/5.
- Jobs unit: 61/61; typecheck passed.
- Ingestion worker: 75/75; typecheck passed.
- Focused web: 39/39; typecheck and production build passed.
- Database-migration unit: 35/35; typecheck passed.
- Fresh isolated PostgreSQL 16 source-to-distinct-target restore: 4/4, including exact `0010`
  checksum-divergence refusal.
- Development migration-image publisher and document-migration operator guard suites passed.
- Serverless infrastructure source validation passed.
- Production-Next installed-Chrome assurance: 5/5 scenarios, including both JSON-LD suppression and
  exact generated-synthetic application-link/`JobPosting` rendering with automated WCAG A/AA rules.
- Exact migration-image index digest: `sha256:1c7fee0911bffa322348179f967c9bda8573a863b4d3db2e43918d5a2c3a66ba`;
  platform digest: `sha256:4842cba2540187c597684e26606f5afe6c4a76cc6ca874af7ab3b479ea46bb76`.
- Applied migration plan SHA-256: `115e4097ac72c08bc6fd4f5d4abdbd4f3ad301d536ee419bb34525d4048bb6d7`.
- Post-apply zero-drift plan SHA-256:
  `0bb7b9b7aff8d2c69395abbeebae837f12aa5e8ac09d0c0a7731983c55c6f4c0`.
- Initial affected ingestion/public artifact plan SHA-256:
  `651f0e80740e44b0381fefe2cd76057f2e8035eefad6fdf0e9866f76f3d32d39`; ingestion aliases are
  exact unweighted version `3` with all dark gates false, empty queues, fourteen healthy alarms,
  and zero ECS services/tasks.
- Corrected public artifact plan SHA-256:
  `0f79c14fbf38655cf39d4db09a6e626f65b047115e919f300bb9fe6f206cf818`; edge SHA-256
  `30e478a168a7d331d7fa3480e286a5ec495d49068f0aef35827a6e5436b7f029`; projection SHA-256
  `1a53fe74f9374918f0ce0631430662f5286b3f76542bebccf7933cee5aef19a1`.
- Final state-154 zero-drift plan SHA-256:
  `3e540da9a4427730b5637fed7614350131a0e8e4cb8b78b6a59154f1da3d8ec8`.

## Remaining gates

1. Obtain exact company/board inputs and record activation authority, then run bounded Ashby network,
   persistence, revalidation, takedown, source-pause, and cleanup acceptance.
2. Run public abuse/load, lifecycle/alias/cache, security/privacy/accessibility, and product acceptance
   before enabling the route or any crawler/indexing surface.
3. Greenhouse and Lever structured data remain suppressed unless their supported provider contracts
   later supply equivalent original-publication and location truth.
