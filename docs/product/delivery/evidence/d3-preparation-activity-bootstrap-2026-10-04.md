# D3-068: Native private preparation activity bootstrap

Date: 2026-10-04
Status: Source, focused/connected, exact-source full verifier and local artifact checks passed; review/release gates remain.

The backend-only branch starts from fresh main `bde17d9`, then locally integrates exact open
#537 head `b516611` as its explicit source dependency. No GitHub merge is performed.

## Implemented path

Accepted identifier-only outbox input → strict existing private activity contract → exact numeric
invoked target and configuration → bounded managed database-secret read → Applications/Profile/
Jobs owner APIs and independent Documents pools → existing default-off isolated preparation port
→ fixed encrypted slots and one numeric isolated Invoke → grounded verified original draft
→ Applications-owned mandatory-review packet. The native `application-preparation-lambda.ts`
exports the lazy handler; module loading performs no secret, SQL, object or provider I/O.

Activation requires exact `APPLICATION_PREPARATION_ACTIVITY_ENABLED=true`, us-east-2, same-account
numeric distinct provider/activity function targets, managed database-secret ARN, bucket and
same-account KMS key through the existing `CANDIDATE_DOCUMENT_BUCKET`/`PLATFORM_KMS_KEY_ARN`
configuration names. Plain database URLs and provider-key/secret configuration are refused.
All configuration is pinned across warm calls; drift refuses recomposition. Session credentials
may rotate. Invalid input is rejected before configuration or I/O, input is detached, and
setup uses one bounded extension request without retry delays. Concurrent calls share read-only
initialization; only failed setup may be retried on a later call. Activity effects are not retried
inside this bootstrap. Default-off/unavailable paths return fixed existing retryable metadata.
Activation withdrawal during setup prevents pool creation; withdrawal during execution withholds
the result. Exact target matching is not caller authentication or remote-writer quiescence.

The Documents-owned `createCoverLetterPersistence` factory creates separate one-connection
raw Date/JSON pools for Documents writes, work authorization and candidate leases. Final-writer
work is frozen to claimFinalDocument plus final_document-only settlement; other purposes refuse
before SQL. Profile and Jobs use their own codecs and Applications its own raw factory, also
limited to one connection. No owner SQL is moved or joined across boundaries. The existing
Applications field ontology is used, so generated cover letters require candidate review.
Jobs' unused search-key requirement receives an invocation-runtime random key; no search/cursor
capability is given to the evidence source. Native S3/Lambda clients use fixed region, one SDK
attempt and ignore configured endpoint URLs. The private runtime receives no model/key.

## Bundle boundary correction

The first actual emitted-bundle check rejected metadata validators emitted from gateway/cleanup
implementation files. Their unchanged interfaces/validation bodies move into pure
`provider-background-contract.ts`; original gateway/cleanup exports re-export the same symbols.
No wire field, terminal meaning, compatibility rule or validator is relaxed. The maintained
private preparation guard now checks both the source port and native activity, positively
requiring controlled preparation/recovery and native persistence while rejecting emitted
ModelGateway, direct generation, OpenAI/background/cleanup, isolated handler, key resolver and
maintenance actor code. Accepted ADRs are unchanged.

## Executed local checks

- 38 new native bootstrap refusal/concurrency/configuration/replay tests and 43 existing
  preparation/evidence tests pass (81 focused). Routing-only seams simulate setup and effects.
- Five native persistence unit tests check distinct pools/codecs, frozen lease/final authority,
  refusal of other settlement purposes before SQL, and closing all owned pools.
- All 283 AI SDK unit cases pass after the unchanged metadata-validator extraction.
- Eleven generated-synthetic real PostgreSQL cases pass, including four new native paths:
  normal completion, installed durable SDK execution/replay, original Invoke-ACK loss recovery
  without another provider request, and owner quarantine refusing finalization. Actual native
  bootstrap/runtime, six independent owner/lease/work pools, existing schemas/migrations,
  S3 command adapters, controlled grants and original draft grounding/PDF/DOCX checks execute.
- The seven earlier fault cases remain: delayed original result after disclosure expiry, lost
  grant/slot acknowledgements stay unresolved without renewed authorization, and quarantine
  retains pending objects/work. Exact consent and hash-bound mandatory-review packet assertions
  remain. No provider settlement is manually seeded.
- Documents/Workflow builds and typechecks plus both actual emitted-bundle isolation cases pass.

Environment: local Windows, Node 24.12.0, pnpm 10.24.0, PostgreSQL 16.14-alpine. The loopback-only
owned tmpfs fixture `private_preparation_d3_068` runs at port 55438. Authentication, managed
secret resolution, S3 acknowledgements, Lambda transport and model responses are simulated.
No live AWS/provider/model request, publication, deployment or activation occurs. Fixture is
removed and Docker Desktop/WSL stopped after SQL checks, retaining shared volumes. Ignored
logs: `.tmp/d3-068-focused.log`, `.tmp/d3-068-persistence-unit.log`, `.tmp/d3-068-ai-unit.log`,
`.tmp/d3-068-integration-final.log`, `.tmp/d3-068-bundle.log`, and package build/typecheck logs.

## Remaining gates

Exact-source full maintained verification and local artifact integrity pass as recorded below. Native
durable/dispatcher/terminal-recovery environment bootstrap and release composition, qualified
caller IAM, secrets/bucket/KMS/private network policies, maintained scheduling, retention,
ambiguous abandonment/original writer drain and accountable/deployed acceptance remain.
Source composition is not deployment or candidate journey evidence. D1/D3 remain In progress,
with no phase-exit changes. Hosted CI/CD stays deferred until production launch.

Pre-review configuration correction: use the established provider bucket/KMS environment names
throughout the activity and native tests. The initial clean e1f00b5 artifact/full run is historical;
a corrected exact-source build and full verifier will supersede it before handoff.

## Final exact-source verification and local artifact

Clean source `a7fb9ba3060711aaf84c086a4850f5e1b61a29af` passes the maintained
`scripts/verify-phase0.ps1` with terminal exit 0 and its completion marker: 38 typecheck tasks,
39 test tasks and 23 builds. All 1,472 Workflow units (31 explicitly skipped; 11 SQL cases separately executed above),
1,160 Documents units and 283 AI SDK units pass. Lint stays at zero errors, 15 warnings and
58 informational notes. Formatting, contract generation, dependency-security regressions,
operational/security guards, provider/maintenance/private-port/native activity emitted isolation
and Compose configuration pass. Log: `.tmp/d3-068-full-verification-a7fb9ba.log` (ignored).

After the established environment-name correction, 81 focused and 11 fresh real PostgreSQL
cases pass again, along with typecheck/build. The owned fixture is removed and Docker Desktop/
WSL are stopped. The earlier e1f00b5 full invocation passed but changed source during execution
and is superseded; it is not the final exact-source proof.

One new unpublished native private-activity family builds directly from clean a7fb9ba. Manifest
schema 2 names Node24/x86_64 and index.handler. Archive SHA256:
`903723884ce3adf43213264e664c44a25f0bcdf76aace50c91d033b553253c6b`
(1,414,855 bytes; 41 SBOM components). Independent checks compare archive bytes/size/base64
checksum, sole index.mjs member, bundle file/hash/source marker and SBOM hash/component count
with the manifest. Actual bytes contain no model-provider endpoint or ModelGateway class.
The builder invokes the actual bundled handler for default-off and extra-content refusals with
zero fetches. A separate probe configures activation and verifies wrong invoked numeric version
refusal before any secret fetch. Local output is ignored under Workflow dist/preparation-lambda;
no object is published or attached to infrastructure and no runtime/IAM is activated.

New evidence links resolve and prior phase/tracker history is retained. No public API, event,
domain, SQL migration, dependency, frontend or infrastructure shape changes. Existing exported
background metadata types/validators remain compatible reexports; source implementations are
unchanged. Native durable/dispatch/terminal-recovery/release wiring, IAM/scheduling, retention/
abandonment/original writer drain and accountable/deployed acceptance remain. D1/D3 remain
In progress. Hosted CI/CD stays deferred until production launch.

## Review handoff

[PR #538](https://github.com/Vrixic/project-ai-job-apply/pull/538) opens on exact #537 source dependency `b516611`. Verified source/artifact
`a7fb9ba` is unchanged; only delivery documentation follows. No merge, publication, deployment
or activation is performed. Native durable/dispatch/recovery/release and accountable acceptance
remain; D1/D3 stay In progress and hosted checks are not monitored.
