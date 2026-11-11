# Web Application Routes

Contains Next.js layouts, route components, and styles. The candidate page starts without
fabricated preference defaults, restores every supported editable preference field, requires explicit
target-role, work-mode, and employment-type choices, and presents the durable operation only as a
narrow saved-preference check—not profile, match, or application readiness. The source-only
onboarding packet is locally verified but is not deployed or accepted in a real browser; its
minimum-compensation amount/currency pair does not represent pay cadence or base/total/annual
compensation.
`api/platform/` is a narrow server-side BFF that keeps Auth0 access and refresh material out of
browser JavaScript. `proxy.ts` owns the Auth0 authorization-code callback and session boundary.

The D1 job-search panel posts bounded filters through `api/platform/jobs/search`, renders only
active canonical summaries, and follows opaque keyset cursors. Search values never enter the
gateway URL, and the search request, result ordering, and result inclusion make no
personalized-match claim. Each result composes the existing owner-self match-evidence panel, which
does not request private evidence until the candidate explicitly selects `Check match evidence`.
The panel does not automatically filter or reorder results, produce a score, or gate saving.

The `View details and sources` link opens that job's own page (`/jobs?job=<id>`), which reads
`api/platform/jobs/[jobId]` as it opens through the server-held session and existing `jobs:read`
permission. It accepts the existing canonical detail projection, including an alias resolving to a
different canonical identifier. Descriptions render literally, while provenance and observation
times accompany validated HTTPS source links with no referrer; rendering never fetches a provider
page. The page has loading and fixed error states, manual retry, and abort/generation fencing across
job, authentication, and unmount transitions. It does not change search ordering, saving, reports,
or match evidence. These source and local-test changes do not establish hosted or managed-OIDC
acceptance or activate the separate anonymous API and indexing gates.

Each active search result also offers an authenticated fixed-reason report control through
`api/platform/jobs/[jobId]/reports`. The BFF accepts only the existing exact report contract,
authenticates the server-held session before reading a bounded streaming body, keeps one
idempotency key for an ambiguous retry of the same job and reason, validates and redacts the
upstream response, and never accepts free text or an owner identifier. A report is review evidence
only and does not automatically change job or source state.

`api/platform/saved-jobs` exposes strict server-side create, keyset-page, and delete forwarding.
The candidate page keeps each distinct requested target owner-private, renders the bounded historical
snapshot
when the current job is unavailable, and aborts/versions requests across refresh and authentication
transitions. Source requests `jobs:write`, but the managed permission grant and deployment remain
outside this packet; no matching or explanation behavior is implied.

`api/platform/entitlements` forwards one exact bodyless self-read with the server-held session and
never forwards browser owner headers or query input. The access panel versions and aborts reads
across authentication changes, validates the exact provider-neutral projection, and shows no prior
account while a new session loads. Free and Pro currently have the same four core capabilities;
the panel contains no payment, upgrade, price, quota, or paid-only feature behavior.

The local-only expanded onboarding page uses array-backed repeated editors for target roles and
optional locations, preserving entry boundaries, commas, and line breaks while trimming entry
edges and deduplicating exact entries. Work modes and employment types are explicit multi-choice
groups; minimum compensation is an optional paired
amount/currency input. Resume upload appears before fact review and parsed completion triggers a
race-guarded proposal reload. Direct-entered facts require an explicit category and are always
submitted as Confidential. Restricted sponsorship, work-authorization, demographic, disability,
veteran, and legal answers remain outside general profile facts. Behind the default-off
`NEXT_PUBLIC_RESTRICTED_ANSWER_VAULT_UI=enabled` gate, a dedicated authenticated panel offers only
the nine established restricted `never_infer` fields. It lists metadata but never plaintext,
requires an explicit choice to save, derives fixed type/sensitivity/provenance, preserves one
idempotency intent across an ambiguous retry, uses optimistic versions, and supports exact-context
delete. Attestations, signatures, challenges, CAPTCHA, and MFA are never offered. This source and
local-test behavior is not deployment, browser acceptance, D3-012 approval, or Applications reuse.
A legacy saved preference containing either sponsorship boolean is not displayed or resubmitted
and blocks the full-replacement save until migration to the dedicated restricted-data boundary.

`jobs/[jobId]` is a dynamic anonymous read-only page over the strict public Jobs projection. It
uses generic not-found and outage states, a temporary canonical-alias redirect, trusted-origin
canonical metadata, default `noindex`, and React text rendering. It conditionally emits escaped
`JobPosting` JSON-LD only when the projection supplies a posting date, application URL, structured
locations, and an on-site or hybrid work mode; an employer-site application link appears only when
the projection supplies an application URL. This is not an automated submission action. The
anonymous API remains separately gated. The dynamically evaluated `robots.ts` denies the entire
candidate application and, only behind the exact reviewed server-only indexing gate, adds a
narrower `/jobs/` allow rule; authenticated and BFF paths remain denied.
