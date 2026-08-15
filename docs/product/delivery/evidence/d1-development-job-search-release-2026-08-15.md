# D1 Development Job Search Release — 2026-08-15

## Outcome

D1-005 Slice A's bounded canonical search and filters are migrated and released in the synthetic
development environment. The exact gateway artifact is active on immutable alias version `17`,
the deployed `POST /v1/jobs/search` boundary returns `200`, all 24 direct boundary cases pass, and
the refresh-backed Terraform verification has zero meaningful changes.

D1-005 remains `In progress`. This evidence does not prove the mutation-driven stale-cursor `409`,
a real OIDC/browser flow, saved jobs, candidate-specific matching, grounded explanations, load
objectives, real source data, or production readiness.

## Database and source boundary

- The composed development migration had already applied Jobs `0004_job_search` through the
  reviewed one-off migration task. Its verified receipt SHA-256 is
  `9f49843112cd8ef94b32c89c67f1e83b135698c031b67357ccfef1b005f2a862`.
- Jobs `0004` owns the full-text and location indexes plus the monotonic catalog-search revision.
  Historical migration bytes were not rewritten or rerun during this gateway release.
- The accepted runtime source is `9d290416c61847f1682157c08312cdb920d42107`, incorporating the
  PostgreSQL timestamp normalization and the fail-closed CompleteDark recovery corrections from
  [PR 276](https://github.com/Vrixic/project-ai-job-apply/pull/276) and
  [PR 277](https://github.com/Vrixic/project-ai-job-apply/pull/277).
- Exact-head local gates passed the full repository check, infrastructure validation, dependency
  audit, PowerShell 5.1/7 operator suites, and the pinned Semgrep workflow-equivalent scan. Hosted
  jobs for the two PRs did not start because of the documented account billing limit; no hosted
  green result is claimed.

## Recovery baseline and immutable publication

- The checksum-bound CompleteDark recovery retained a nonapplyable serial-107 input baseline with
  plan SHA-256 `2143c836f9c55d2126efef55b314f167b35d593d64338791cb6c3837c6e2a6a4`
  and adjacent metadata SHA-256
  `e0efc63e7c17685e363e23f15f7f1d39e83c46beff3f08fdb768bd67e78b8011`.
  Two independent reviews found zero meaningful changes and preserved the current parser with the
  processor's retained numeric parser pin.
- The [gateway release operator](../../../../scripts/operate-development-gateway-release.ps1)
  ran its tests and dependency audit, built twice byte-for-byte, and conditionally published four
  previously unused immutable objects: ZIP, CycloneDX 1.6 SBOM, manifest, and checksum.
- Publication receipt SHA-256:
  `84d4e996ec5bfa7ce2c6a31c116dc04a0cbe6980e66128d480158c7f98177519`.
- Gateway ZIP SHA-256:
  `d5802809267d15d8597948a053c8f6613d3023bc85429fc2c7178173090d2715`.
- Independent reviewers downloaded each exact object version and accepted its length, hexadecimal
  and base64 checksums, customer-KMS encryption, bucket-key setting, source/artifact metadata,
  manifest, single bundled handler provenance marker, and 143-component SBOM. Publication did not
  move the Lambda alias or change Terraform state.

## Reviewed Plan and Apply

- Saved release-plan SHA-256:
  `891d859c05651621306be63317046223f17a3b559e3d380138d3e9e603be52ef`.
- Adjacent release metadata SHA-256:
  `6f37ac87d8f6ae9f88e5b1a53720710587a46f7c99b19153a6d61d5ea692f4e9`.
- Two independent reviewers accepted exactly two managed in-place updates: the gateway Lambda
  function and its development alias. There were no creates, deletes, replacements, or output
  changes. All 54 Terraform variables matched the accepted baseline except the four receipt-bound
  gateway artifact values. The only provider refresh record was the accepted forward-only RDS
  restore-clock normalization.
- The exact Plan was applied once after the temporary development SSO session was refreshed. The
  closed Apply log SHA-256 is
  `e36d8d390e2df13d6fea07e264026a82d0f5aeee0d4cc71b2d0710df73c67070`
  and records `0 added, 2 changed, 0 destroyed`.
- Terraform state advanced exactly once from serial `107` to `108` with unchanged lineage. Alias
  version `17` is active, has no weighted routing, and its live code checksum and `RELEASE_SHA`
  match the reviewed immutable artifact.

## Deployed verification

- The independent read-only boundary verifier passed all 24 cases. Public liveness/readiness and
  anonymous denial passed before and after the direct matrix.
- The matrix proves authenticated synthetic-authorizer search `200`, missing/invalid identity
  `401`, insufficient scope `403`, strict body and query rejection `400`, oversized body `413`,
  unsupported media `415`, and unknown routes `404`. The search response passed the canonical
  page, timestamp-field, item/company/location, and optional cursor syntax/length guard.
- No persistent application write or public-traffic change occurred during the boundary verifier.
  This synthetic direct-Lambda authorization context is not a real managed-OIDC browser session.
- All 24 platform alarms were `OK`. The exact Apply and verification logs contained no raw database
  URI, password, bearer token, private key, or restricted request marker.
- Verification-plan SHA-256:
  `268497d62b3ef7d7867dc6aa8f6ed443f402f4dd99b543156c900dc6acc5f7c5`.
  It is nonapplyable with all 159 resource changes and all 32 output changes as no-ops; its sole
  refresh record is the accepted RDS clock normalization. The adjacent verification log SHA-256 is
  `bc13c7e2e8d5cbb28de167f3b3f28e6e262e78456c47865796a43074ae566e44`.
- CompleteDark remained fail-closed: the processor kept its retained numeric parser pin, the only
  mapping and processing rules remained disabled, all six queues were empty, and endpoint/IAM
  boundaries remained exact.

## Remaining D1-005 gates

- The [Jobs-owned stale-cursor acceptance foundation](d1-job-search-stale-cursor-acceptance-foundation-2026-08-15.md)
  is implemented, independently reviewed, and locally verified after this release. It still
  requires merge, immutable migration-image and task-definition release, and execution of the
  exact guarded operator against the deployed boundary; do not replace those gates with ad hoc SQL
  or a general command override.
- Prove a genuine cursor becomes `409 job_search_catalog_changed` after one explicitly reviewed
  catalog revision and that a fresh restart returns the unchanged ordered result set without
  duplicates or omissions.
- Prove the managed-OIDC/server-held-token BFF and browser flow against this exact release.
- Implement and accept Matching-owned saved jobs, structured hard constraints, and grounded
  explanations. No Profile or Jobs cross-schema join may be introduced.
