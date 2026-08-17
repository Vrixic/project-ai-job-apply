# D1 local browser assurance

Run `pnpm test:d1-browser-assurance` after installing root development dependencies. The bounded
runner uses a locally installed Chrome binary, a loopback-only test server, generated-synthetic BFF
responses, direct Playwright Core assertions, and injected axe-core WCAG rules. It never downloads a
browser and leaves no server or generated bundle running after completion.

The harness lives outside `frontend/web`, and Playwright Core plus axe-core are root development-only
tools. Neither the harness nor its dependencies belong to the production web package, pnpm
production dependency closure, or Next build output.

This automated suite is not human accessibility acceptance and does not exercise managed OIDC, a
deployed BFF/gateway, deployed security headers, assistive-technology combinations, visual
regression, mobile browsers, or real candidate data.
