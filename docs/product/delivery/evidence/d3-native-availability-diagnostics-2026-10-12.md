# D3 native approval availability diagnostics — 2026-10-12

D3-116 adds bounded failure diagnostics for the bodyless native-material check required by
approval. The live synthetic resume preview passed through separate in-memory Auth0 sign-in,
but approval returned 503 twice in approximately 0.4 seconds. No cause is established yet.

Gateway now records only a fixed failure stage, HTTP status and bounded transport category.
Tokens, raw errors, addresses, references and generated content are excluded. Diagnostic sink
failure cannot change the existing availability refusal. Authentication, packet authority,
TLS verification and original expiry rules remain enforced.

Executed: 31 focused availability/location tests, Gateway TypeScript check and four-file Biome
check pass. Tests cover status/metadata distinctions, transport categorization, redaction and
diagnostic-sink failure. Managed diagnostic deployment and the successful live approval journey
remain required; this change does not claim the approval failure is fixed.

Live AI stays off without a qualifying 30-minute all-copy policy. Employer submission stays off
without authorized ATS QA/fixtures and grants. Independent D1/admin acceptance remains deferred.
