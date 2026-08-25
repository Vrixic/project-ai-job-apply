# ADR-026: Host Next.js Presentation Boundaries on Vercel

Status: Accepted
Date: 2026-08-25

## Context

Phase 1 needs a stable HTTPS deployment for the candidate Next.js BFF and, after its separate
authorization gates pass, the moderation console. The authoritative API and data plane already run
on AWS API Gateway, versioned Lambda aliases, Lambda durable functions, PostgreSQL, SQS, S3, KMS,
and CloudWatch. Reintroducing an always-on AWS web container would add deployment and idle-compute
surface without improving those boundaries.

The candidate and moderation applications have different users, OAuth permissions, session
policies, exposure, and release gates. Auth0 requires exact callback/logout origins, while Vercel
preview hosts are dynamic. The repository also prohibits browser-held access tokens, shared
candidate/admin credentials, production PII in previews, and wildcard production origins.

## Decision

Use Vercel to host the repository's Next.js presentation and server-side BFF boundaries.

- Create two Vercel projects from the same monorepo: candidate web rooted at `frontend/web` and
  moderation admin rooted at `frontend/admin`. Do not combine them behind one project, session, or
  Auth0 application.
- Run Vercel Functions in `iad1`, the closest available single Vercel region to the authoritative
  AWS `us-east-2` API boundary. Static assets may use Vercel's edge network. Add another function
  region only after measured availability/latency evidence and a data-flow review.
- Keep AWS API Gateway/Lambda and the domain-owned databases authoritative. Vercel persists no
  product record, workflow state, access token, candidate artifact, or moderation audit truth.
- Keep Auth0 access and refresh tokens in encrypted server-held sessions. `AUTH0_CLIENT_SECRET`,
  `AUTH0_SECRET`, access tokens, and other credentials must never use `NEXT_PUBLIC_*`, enter source,
  or appear in deployment evidence.
- Give candidate web and admin distinct Auth0 Regular Web Applications, client secrets, session
  secrets, exact HTTPS callback/logout URLs, and grants. Candidate web excludes `jobs:moderate`;
  admin requests only `openid profile jobs:moderate`, proves MFA, uses bounded sessions, and has no
  refresh-token/offline-access grant.
- Configure managed OIDC only for one stable, explicitly allowlisted hostname per project. Dynamic
  previews remain identity-dark by default; do not add Auth0 wildcard callback, logout, or origin
  entries to make arbitrary previews authenticate.
- Scope Vercel secrets independently to the owning project and target. Preview deployments receive
  no real candidate/admin credentials or production API target. Enable Vercel Authentication for
  previews. Do not treat a generated deployment URL as confidential.
- Keep `PUBLIC_JOB_INDEXING_ENABLED=false` and the AWS anonymous public route absent until D1-009's
  publication, abuse, lifecycle, accessibility, and accountable acceptance gates pass.
- Keep the admin production deployment unavailable until the dedicated managed Auth0 application,
  exact `jobs:moderate` grant, MFA-protected synthetic moderator, and D1P authority are configured.
- Apply repository-owned baseline response headers to both applications. Admin additionally sends
  a response-level crawler denial. Expand the Content Security Policy only with deployed evidence;
  never claim the current minimum directive set is a complete CSP review.
- Vercel becomes a candidate subprocessor before it carries a real candidate session or request.
  Synthetic deployment does not waive the provider, DPA, region, retention, deletion, incident,
  privacy, or independent-security gates for real users.

## Consequences

The web tier scales with traffic and can be deployed independently of the AWS API release. Two
projects preserve credential, permission, deployment, and failure isolation and make the admin
surface independently disableable.

The platform now has an additional service provider and network hop. Vercel may observe request
metadata and execute BFF code, so logs, request projections, environment variables, provider terms,
and deletion/incident behavior require explicit review before real candidate use. Cross-provider
latency must be measured against the deployed hostname rather than inferred from local or direct API
workloads.

An exact stable hostname is required before Auth0 callback configuration. Arbitrary preview
deployments cannot complete managed login without separately adding their exact URLs, which is
intentionally not the default workflow.

## Alternatives

- **Run Next.js continuously on ECS/Fargate.** Rejected because the prelaunch presentation tier does
  not justify always-on compute and would reverse the scale-to-zero direction of ADR-016.
- **Package Next.js into AWS Lambda manually.** Viable, but not selected because it adds framework
  adapter and release ownership when Vercel directly supports the chosen Next.js runtime.
- **Use one Vercel project for candidate and admin paths.** Rejected because it would couple
  credentials, permissions, exposure, release cadence, and incident containment.
- **Enable Auth0 on every dynamic preview with wildcard origins.** Rejected because it weakens the
  accepted exact-origin boundary and expands credential-bearing deployments without a product need.
