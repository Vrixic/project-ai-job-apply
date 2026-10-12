# D3 native Fastify credential context — 2026-10-12

D3-118 corrects a real injection-boundary gap in D3-117. Gateway 106 still returned native HEAD
401. Replacing the mocked injector with warmed Fastify reproduced the opaque-token forwarding
on all four routes: LightMyRequest starts injection lazily when its thenable is awaited.

Awaiting that thenable inside the invocation credential context preserves the original JWT for
the controller's exact capability/application lookup. Credential cleanup, opaque application
headers, native authentication and the original material deadline remain enforced.

Executed: all 144 targeted Gateway regressions and Gateway build/typecheck pass after the fix.
The four real Fastify route cases failed before it. The original live material expired, approval
became disabled, its task was positively STOPPED and its preparation workflow SUCCEEDED.
Live approval/downloads remain unverified; a fresh packet requires fresh review and approval.

Live AI and employer submission remain off. Independent D1/admin acceptance remains deferred.
