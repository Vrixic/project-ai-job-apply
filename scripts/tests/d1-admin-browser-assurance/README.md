# D1 local admin browser assurance

Run `pnpm test:d1-admin-browser-assurance` after installing root development dependencies. The
bounded runner uses a locally installed Chrome binary, a loopback-only gallery, generated-synthetic
moderation responses, Playwright Core assertions, and axe-core WCAG rules. It never downloads a
browser and removes its generated bundle and listener after the run.

The scenarios mount the production `ModerationConsole`. They cover signed-page consumption,
explicit two-step job-block confirmation, exact source-target input requirements, aggregate-only
report display, stale queue-response fencing, private-field redaction, keyboard focus, and automated
WCAG A/AA rules. The harness and its browser dependencies remain outside the production admin
package.

This evidence is local and generated-synthetic. It does not authorize or prove a managed admin
identity/grant, deployment, real candidate reports, provider activation, accountable moderation
policy, human accessibility, assistive technology, or privileged production action.
