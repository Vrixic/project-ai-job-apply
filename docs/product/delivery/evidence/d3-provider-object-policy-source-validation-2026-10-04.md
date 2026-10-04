# D3-062 provider object policy source validation

Date: 2026-10-04. Source: `257ae8c746180cb7ad4c725be8442b0bdfca73dd`, independently
branched from merged main `5dae0f6`. D1/D3 remain In progress.

The [provider-free module](../../../../infrastructure/terraform/modules/cover-letter-provider-objects/README.md)
renders an unattached S3 identity policy. No environment calls it; there are no resources,
roles, attachments, caller grants, runtime changes or activation. Candidate identifiers,
bucket and key in tests are synthetic. No production PII, credential or raw candidate artifact
is retained here. Docker/WSL remained stopped; no persistence or UI change required their use.

Local evidence: Terraform 1.16.2 init/validate/fmt and all seven native plan tests pass.
The [actual-plan offline suite](../../../../scripts/tests/cover-letter-provider-object-policy.test.mjs)
passes 46 cases, including broad additional S3 grants and seven unsafe guard-removal regressions.
Full `scripts/verify-phase0.ps1` passes terminally for the source above: 38 typecheck tasks,
39 test tasks, 23 builds, unchanged public contracts/formatting/baseline lint and operational,
security, Compose and scope checks. Lint remains 0 errors, 15 warnings and 58 informational notes.

Read-only AWS checks used the existing development admin SSO profile after STS confirmed account
`362544434697`, with region `us-east-2`. The actual rendered synthetic policy SHA-256 is
`ebecc11d11538a2c1db7d2feb40d57b4e2277637099b4cc7cf1c9c14f027c06c`.
`accessanalyzer validate-policy --policy-type IDENTITY_POLICY` returned zero errors/security
warnings and one general `WILDCARD_WITHOUT_LIKE_OPERATOR` warning. It points to the intentional
literal `*` in `StringEquals` that denies wildcard If-Match. Changing this to `StringLike "*"`
would deny valid ETags too. The warning is retained for independent review; no waiver is issued.
Local response SHA-256: `316705d889c7f20b02a9ffdc247fdc04f691aa5bcfd9253167d191c9a32b8962`.

AWS `iam simulate-custom-policy` passed all 61 evaluated action/resource/context combinations:
fixed-slot reads and encrypted ETag replacements, immutable request, forbidden actions/resources,
additional broad S3 grants, absent/wildcard match, creation header, multipart without exemption,
copy source, encryption, transport and separate KMS/secret/RPC capabilities. These APIs validate
or simulate documents; they neither attach them nor test actual S3 operations. Local normalized
simulation response SHA-256: `727589a6e0a6dc5fc25ac4fc23ece0532604cec48569efdb0cca47ef3d74d7c5`.

Independent complete-role/bucket/KMS/caller review, actual S3 adversarial enforcement, immutable
provider runtime, transient retention, original writer drain, restore and deployed acceptance
remain. Wildcard slot paths do not validate UUIDs, ownership, request hashes or pinned versions;
the handler and owning protocols remain responsible. No quiescence or purge certificate follows.

[PR #531](https://github.com/Vrixic/project-ai-job-apply/pull/531), on separate eligibility-RPC
source `6c3a1ab`, subsequently merges as `7cf19d0` after the owner defers hosted CI/CD
until production launch. Its complete tree `77c82be` matches the verified source. Original results: Its [CI](https://github.com/Vrixic/project-ai-job-apply/actions/runs/37212070251)
quality/catalog pass; audit fails, and integration/container jobs never started because GitHub
reports account payments/spending limits. Owner input was requested. Its
[scanner](https://github.com/Vrixic/project-ai-job-apply/actions/runs/37212070287) fails with
65 findings on 30 paths independently outside its eleven changed files. No suppression/waiver,
hosted SQL/container verification or deployment is claimed.

The owner's CI/CD deferral permits source progress and merging with local verification; it
does not authorize deployment, activation, production security exceptions or phase completion.

Combined source `8f37b1e` passes the same complete verifier after integrating merged #531;
all backend/packages/frontend application files equal verified main `7cf19d0`, and the policy
and tests are byte-identical to `257ae8c`. Merge conflicts were confined to delivery records;
all original D3-061 work-log rows and summary are preserved alongside the owner decision.
