# D1 public job page local assurance

Run `pnpm test:d1-public-job-page-assurance` after installing the pinned workspace dependencies.
The command first builds the production Next application, then starts it and an exact synthetic
public-projection stub on loopback only. A locally installed Chrome browser exercises the real
`/jobs/{jobId}` route; the runner never downloads a browser and shuts down both servers.

The generated-synthetic scenarios cover canonical metadata with indexing disabled, temporary
alias redirection to the exact canonical path, generic handling of an explicitly expired target
and an invalid identifier, default `robots.txt` denial, credentialless and bodyless
public-projection reads, plain-text rendering of an HTML-like description canary, absence of
`JobPosting` JSON-LD, automated WCAG A/AA rules, and a small concurrent local request burst. The
stub rejects unexpected routes, methods, query strings, bodies, cookies, and authorization
headers. Its typed expired-target response exercises the public page's generic absence boundary;
it does not prove backend lifecycle filtering.

This is local source assurance only. The request burst checks bounded local consistency; it is not
WAF, throttling, abuse-control, representative-load, performance, or capacity acceptance. The
suite does not exercise or approve AWS, deployment, API Gateway, Lambda, database persistence,
deployed headers, DNS, TLS, a public origin or brand, provider data, real job data, crawler
activation, search-engine eligibility, legal publication, `JobPosting` JSON-LD, human
accessibility, assistive technology, visual regression, or mobile browsers.
