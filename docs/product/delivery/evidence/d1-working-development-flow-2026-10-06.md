# D1 working development connection — 2026-10-06

Status: partial live development flow; D1/D3 remain In progress.

The isolated backend worktree starts from freshly fetched main `88f8ae84` on
`feat/d1-working-development-flow`. Owner direction is implementation-first batches toward a
working launch, followed by actual-flow checks, concrete fixes and focused regression coverage.

Read-only AWS inspection confirms development Gateway alias `development` is unweighted version
`86`, active, with release `c6ac1bef2f12e2ba7f18f45829503994e4eaf52d603f5cd333c67322806010a5`.
Both API health endpoints return 200 with that release. Jobs/profile calls without identity return
401. The actual API has managed Auth0 JWT authentication. Earlier D1 version-38 deployment
paragraphs are historical evidence, not the current runtime.

The existing local web settings pointed at `localhost:4000`, with no API listening there. An
ignored isolated configuration now connects the existing web to the live development Gateway.
The original frontend workspace is preserved. No frontend source or cloud state is changed.

Google refused the automated Chrome sign-in. Google documents that automated browsers can be
blocked: [supported browser guidance](https://support.google.com/accounts/answer/7675428?hl=en).
The owner then signed in in regular Chrome and confirmed unfiltered search returns jobs.
Sanitized local runtime observations confirm `/jobs` 200, saved-jobs search 200 and job search
200. The owner also confirms Profile opens without errors and saving/reloading retains the job.
Runtime observations confirm Profile/facts 200, save 201 and saved-jobs reads 200; preferences
return 404 for an unset preference set. Before sign-in, Profile, preferences, entitlements and resume BFF reads return 401/no-store.
This uses managed sign-in and the live API, without simulated tokens or API replies. Browser
automation cannot control that regular Chrome session, so the owner supplies visible-flow
confirmation while route/status observations corroborate actual requests. No browser cookies,
tokens, callback query values or candidate payloads are copied into evidence.

`scripts/start-development-web.ps1` makes this connection repeatable using existing ignored
identity settings and an explicit API origin. It checks matching healthy Gateway releases,
keeps the registered localhost callback/port aligned, and overrides the API target only in the
web process. It neither rewrites identity files nor deploys, starts Docker or opens an automated
browser. `-CheckOnly` passes against the live development API; four unsafe origins refuse and
the identity file's before/after digest is unchanged. The launcher starts actual local Next.js successfully against the verified API; the maintained
full verifier remains pending before handoff.

Preference write/read, resume import and the remaining
deployed/public/moderation/rights/final acceptance requirements are not claimed from these checks.
No D1 exit criterion or phase completion is asserted. Hosted CI/CD stays deferred until production
launch. Docker/WSL remain stopped and the PC remains on.
