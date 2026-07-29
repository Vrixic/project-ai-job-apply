# Web Application Routes

Contains Next.js layouts, route components, and styles. The Phase 0 page exercises the preference
and readiness workflow while failing closed when no managed OIDC provider is configured.
`api/platform/` is a narrow server-side BFF that keeps Auth0 access and refresh material out of
browser JavaScript. `proxy.ts` owns the Auth0 authorization-code callback and session boundary.
