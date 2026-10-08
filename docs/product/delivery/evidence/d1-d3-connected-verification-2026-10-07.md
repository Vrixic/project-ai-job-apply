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

## Consistent six-artifact resume family

Both complete `pnpm --filter @ai-job-apply/workflows build:lambda:native-resume` runs passed
from clean `baab14635bafb77916d249346ad141c2524a4306`. All six ZIPs and their 24 release
companions are byte-identical between builds. Inspection verifies each single-file ZIP's bundle
hash/source marker, exact source manifest, ZIP length/base64/checksum, CycloneDX 1.6 SBOM
hash/component count and companion checksum. Builders also exercise their emitted disabled
handlers; this is not enabled AWS/SQL/DNS behavior or a dependency audit.

| Artifact | ZIP SHA256 | Bytes | SBOM components |
|---|---|---:|---:|
| native-resume-owner-rpc-lambda | `0aa6771e43a92526ac4dda8afe93f27719ea65e395150d45fddee6530d598ac5` | 158802 | 35 |
| native-resume-source-rpc-lambda | `5336dd31afa765606cf9b3a6536d5659425b8d9dc7d54e1f14d5ef97e8a06d6a` | 432627 | 38 |
| native-resume-preparation-control-lambda | `81ed74b3c6bdc4b892c38ec596c5f91b4a2f66197b2aa2932c328ee3aa49ca02` | 740427 | 35 |
| native-resume-preparation-durable-lambda | `dd80902334b61254868f4565d94917e116a41e17ed5da315414d8e91c9decfce` | 421248 | 29 |
| native-resume-request-dispatch-lambda | `1e8863f58ce09726f38dea31761b8e830e95bd2ad7928d4b6d47867421a4fd64` | 556038 | 34 |
| native-resume-task-observer-lambda | `51a11e64e8d7b1e80547527c35e70212a3f86c86296ce8194c8c760b9201570a` | 463855 | 34 |

Logs and both complete hash inventories remain ignored under
`.tmp/d3-connected-resume-family-*`. Outputs are in
`backend/workflows/dist/native-resume-lambda/`. No release objects were published, no runtime
was activated and no managed receipt is claimed. The separately built migration image retains
its `0bfe741c` identity. Current native task-image verification remains a next local gate;
managed DNS/TLS/domain decisions and live acceptance remain open. Development web remains
running; Docker/WSL are stopped and the PC is on.

## Current native resume image

A frozen Git archive of clean `5b45fd12942a400d6aeb7aeba49644c1798f9e1c` builds successfully
with `Dockerfile.native-resume` for Linux/amd64. Local tag
`ai-job-apply-native-resume-local:5b45fd12` resolves to
`sha256:cd3e35b1093c1dbddc0e96cb490385477c415b153c0a8fcba77bf2543229043b`.

The normal production entrypoint with its image-owned disabled configuration exits 1 and emits
only `NativeImageConfigurationUnavailable`. The unchanged `verify-native-resume-image.mjs`
then runs the image-owned runtime/kernel with synthetic ports under UID 65532, init, disabled
networking, read-only root, dropped capabilities, no-new-privileges and bounded memory/PIDs.
It passes 23 runtime assertions, renders and verifies both PDF and DOCX, exercises TLS 1.3 and
JWT/current-packet checks, rejects foreign/forged/unscoped or revoked access and packet races,
and observes native timer termination (exit 137, Docker `OOMKilled=false`) in 6,599 ms.
The fixture accelerates the native deadline to five seconds; scalar completion/expiry retains
the original 30-minute interval. This is not a wall-clock 30-minute endurance test.

Manifest source and runtime/configuration/kernel hashes are checked inside the image. The
fixture replaces the entrypoint and uses `NODE_ENV=test` for synthetic AWS, identity, source,
owner and TLS-secret ports. Actual rendering, HTTPS and kernel behavior are exercised; enabled
production startup, managed transport/IAM/DNS/TLS, candidate browser/ATS integration, remote
retirement and all-copy disposal remain unverified. One image was built; no reproducibility,
scan, publication, deployment or real candidate-data claim follows. ADR-040 stays Proposed.

Ignored logs/receipt: `.tmp/d3-connected-native-resume-image-{build.log,inspect.json,default-off.log,smoke.log}`.
The harness removed its owned container and staging; inspection found no remaining labeled
container. Docker Desktop and WSL were stopped after the checks; shared images/volumes and the
running local development web server were retained. PC remains on.
