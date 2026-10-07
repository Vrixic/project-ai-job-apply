# D1/D3 connected local verification — 2026-10-07

The connected backend batch is locally verified after one integration fix. D1 and D3 remain
In progress; this does not establish deployed or authenticated end-to-end acceptance.

## Source and correction

The maintained verifier started from clean `0bfe741c`. Its workspace test stage caught an
outdated restore-manifest pin in deletion replay after Applications migration 0011. Commit
`dd61044ae2cc476358d6168d454cb83542d1fc18` updates both TypeScript and PowerShell validators
and recomputes the synthetic fixture configuration/inspection hashes. Validation stays strict.
The existing regression detected the mismatch; no additional test was needed.

## Verification

This was a split verification run, not a single uninterrupted green full run:

- Initial `scripts/verify-phase0.ps1` passed contracts, skills, infrastructure/operator guards,
  migration runtime smoke (183 checks), formatting, lint, type checking and dependency
  regression checks before the restore-manifest test failed.
- After the fix, all 207 restore-contract tests, 697 replay checks and 908 restore-role checks
  passed. Formatting passed for the edited TypeScript/JSON; `git diff --check` passed.
- Repeated all 38 typecheck tasks and all 39 workspace test tasks, then executed the maintained
  verifier from its Tests stage through all 23 builds, every emitted isolation check, Compose
  configuration and product-scope checks. All passed at `dd61044a`.
- Workspace results include 1,917 Documents, 1,839 Workflows and 344 Gateway passing tests.
  Workflows skips 115 and Gateway skips 106 environment-dependent cases in this unit run;
  this run does not replace previously recorded real PostgreSQL checks or live acceptance.
- Existing dependency advisories remain open; dependency regression tests are not a fresh
  registry audit, image scan or security approval.

Ignored local logs: `.tmp/d3-connected-verification.log`,
`.tmp/d3-connected-restore-fix.log`, `.tmp/d3-connected-verification-remainder.log`.
The remainder script copies the maintained verifier's stages without modifying their checks.

## Migration image

A frozen `git archive` of `0bfe741c` produced local Linux/amd64 image
`ai-job-apply-migration:local-0bfe741c`, inspected image ID
`sha256:56b39e120324c48237742ea2b2773590494220635ce18b3036fef88770f81784`.
Its revision label is `0bfe741c`. The publisher's unchanged runtime smoke passed with
network disabled, read-only filesystem, UID/GID 65532, all capabilities dropped and
no-new-privileges. All 74 migration files, checksums, 93 relations, 12 schemas and seven
owners matched the packaged restore manifest. The later replay-pin fix changes no packaged migration
files or owning service sources. The image retains its original source identity. This is one local build: no reproducibility claim, scan, publication or managed
migration. Logs/receipt remain in `.tmp/d3-connected-migration-image-*`.

## Operating state and remaining work

Docker Desktop and WSL stopped after image validation; the PC remains on. The isolated
local development web server was restored against the existing development API; its managed
identity configuration was preserved. Anonymous HTTP checks returned root 200 and `/resume` 307;
these are health/authentication-boundary checks, not signed-in UI acceptance. Previously accepted sign-in, search, Profile and
save/reload checks are not reopened. No frontend source, CI/CD, cloud activation, PR or main
merge is included. Managed resume routing/TLS/domain choices, release/recovery acceptance,
remaining D1 flows, ATS/client acceptance and accountable launch gates remain open.
