# Gateway Source

Contains the NestJS/Fastify composition root, public controllers, authentication enforcement,
contract validation, trace propagation, privacy-safe log-delivery heartbeat lifecycle, and problem
responses. Long-running work is delegated.

`GET /v1/extension/contribution-capability-policy` is registered only when the Gateway receives
the same verified signed-policy source used by Jobs intake. It is anonymous and always
`Cache-Control: no-store`, returns only the bounded signed envelope (never the pinned keys), and
collapses missing, stale, malformed, forked, or unverifiable policy state to one fixed safe `503`.
Local startup opts in only through the explicit Jobs policy environment pair. The Lambda boundary
does not allow this route until a separate exact activation seam is implemented, so deployed
Lambda remains default-dark.
