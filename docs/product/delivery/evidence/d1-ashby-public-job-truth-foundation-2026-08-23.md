# D1 Ashby public-job truth foundation — 2026-08-23

## Outcome

Current source can carry provider-original publication time, an exact employer application URL,
and structured physical job locations from a reviewed Ashby public job-board response through the
ingestion worker, Jobs persistence, isolated anonymous projection, generated API contract, and
canonical Next job page. Complete on-site or hybrid projections emit guarded `JobPosting` JSON-LD;
incomplete or remote projections emit none. The page may show the exact external application link,
but does not submit an application or claim confirmation.

This is source and local generated-synthetic evidence only. Jobs migration
`0010_public_job_truth_fields` is not published or applied in AWS, the public route remains absent,
indexing remains disabled, and no provider configuration, provider request/data, real job, real
candidate, or application occurred.

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

## Remaining gates

1. Commit a stable exact source, deterministically build and immutably publish the nineteen-migration
   image and affected Lambda/web artifacts, then scan and read back their exact identities.
2. Apply Jobs `0010` through a reviewed development migration plan and release the affected dark
   runtime while keeping provider authority, sources, triggers, public route, and indexing disabled.
3. Obtain exact company/board inputs and record activation authority, then run bounded Ashby network,
   persistence, revalidation, takedown, source-pause, and cleanup acceptance.
4. Run public abuse/load, lifecycle/alias/cache, security/privacy/accessibility, and product acceptance
   before enabling the route or any crawler/indexing surface.
5. Greenhouse and Lever structured data remain suppressed unless their supported provider contracts
   later supply equivalent original-publication and location truth.
