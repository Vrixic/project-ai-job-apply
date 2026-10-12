# D3 native invocation credential — 2026-10-12

D3-117 corrects the live approval 503 diagnosed by D3-116: native HEAD returned 401 because
Lambda replaced the caller JWT with its internal invocation capability, which the approval
controller then forwarded as though it were a JWT.

The trusted Lambda boundary now retains the upstream-validated caller credential in a private
async-local context for the four exact native-check POST routes. Application authentication still
uses the opaque capability. Native HEAD receives the original JWT only when the internal
capability and application match. Both contexts clear their credential references on completion;
detached reuse fails closed. Native OIDC, owner, packet, TLS and expiry checks are unchanged.

Executed: 144 targeted Gateway tests, component build/typecheck, focused Biome/diff checks and
consequential security review pass. Regressions exercise the Lambda handler through native HEAD
for all four routes, concurrent requests, foreign capability/application and detached reuse.
An initial test fixture incorrectly supplied a dispatch body and omitted AWS context fields;
the fixture was corrected before the passing rerun. Managed deployment and live retry remain.

Live AI and employer submission stay off pending their existing external prerequisites.
Independent D1/admin acceptance remains deferred.
