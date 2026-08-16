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
gateway URL, and the panel makes no personalized-match claim.

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
veteran, and legal answers are not collected by this page. A legacy saved preference containing
either sponsorship boolean is not displayed or resubmitted and blocks the full-replacement save
until migration to the future dedicated restricted-data boundary. These are source and local-test
claims only, not deployment or real-browser acceptance.

`jobs/[jobId]` is a dynamic anonymous read-only page over the strict public Jobs projection. It
uses generic not-found and outage states, a temporary canonical-alias redirect, trusted-origin
canonical metadata, default `noindex`, and React text rendering. It contains no JSON-LD or apply
action. The dynamically evaluated `robots.ts` denies the entire candidate application and, only
behind the exact reviewed server-only indexing gate, adds a narrower `/jobs/` allow rule;
authenticated and BFF paths remain denied.
