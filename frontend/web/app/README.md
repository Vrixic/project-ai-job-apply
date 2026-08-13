# Web Application Routes

Contains Next.js layouts, route components, and styles. The Phase 0 page exercises the preference
and readiness workflow while failing closed when no managed OIDC provider is configured.
`api/platform/` is a narrow server-side BFF that keeps Auth0 access and refresh material out of
browser JavaScript. `proxy.ts` owns the Auth0 authorization-code callback and session boundary.

The D1 job-search panel posts bounded filters through `api/platform/jobs/search`, renders only
active canonical summaries, and follows opaque keyset cursors. Search values never enter the
gateway URL, and the panel makes no personalized-match claim.
