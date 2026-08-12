# Phase 0 Security/Privacy Engineering Pre-Audit — 2026-08-12

- Original delivery task: Removed D0-015; mandatory input to D6-015 under ADR-020
- Evidence state: Engineering pre-audit passed; accountable exact-candidate disposition deferred
- Scope: Synthetic-only Phase 0 foundation and changes since the last successful full static scan
- Review boundary: This is not independent security testing, privacy/legal approval, or permission
  to activate real data, providers, public users, external actions, or launch

## Result

No unresolved Critical or High engineering issue was identified for the synthetic-only Phase 0
foundation. One static-analysis concern in the ATS fixture validator was removed by replacing
slug/version regular expressions with explicit linear character validation. A separate XSS rule
matched the deliberate `<script>` attack string in a negative test; the suppression is limited to
that exact test line and the test continues to prove active content is rejected.

The independent security/privacy reviewer and product-risk owner have not completed their D6-015
dispositions. This record can prefill objective foundation evidence only and does not approve the
foundation or close the public-launch gate.

## Fresh verification

| Check | Result |
|---|---|
| Complete Phase 0 repository verifier | Passed: contracts, skills, serverless policy, format, lint, types, tests, builds, and Compose validation |
| Central dependency audit | Passed with two exact, expiring mobile-build exceptions already recorded in the [exception register](../../../security/dependency-vulnerability-exceptions.md) |
| Authentication package | 7/7 tests passed |
| Gateway authorization and privacy behavior | 40/40 tests passed |
| Server-held web session/conformance helpers | 40/40 tests passed |
| Serverless infrastructure policy | Passed; only Lambda request/workflow runtimes and the on-demand migration task remain |
| Tracked-file high-confidence credential pattern scan | No private-key, AWS access-key, Google key, GitHub token, or OpenAI-key pattern found |
| ATS fixture validator | 11/11 tests passed, including expired authorization, overdue revalidation, active content, integrity, secret/PII evidence, and linear slug validation |
| Changed application SAST | Pinned Semgrep `1.172.0` and rules commit `81634cfc9e68dc5f238a8062909a60ba34500648`: 32 rules over 33 changed JS/TS files, zero findings after remediation |
| Changed infrastructure/workflow SAST | Same pinned scanner/rules: 95 rules over 8 parsed files from 14 changed targets, zero findings; existing narrow Multi-AZ and separately managed S3-versioning suppressions were honored |
| Diff and changed-document links | Passed |

The incremental SAST boundary starts at the last successful full repository scan,
[GitHub Actions run 31246727120](https://github.com/Vrixic/project-ai-job-apply/actions/runs/31246727120)
for commit `42e1a49d122cc613a69b2a82a441197594230764`. Every changed executable JS/TS target and changed
Terraform/Dockerfile/workflow target that still exists was scanned locally with the same pinned
rules. Dependency changes are independently covered by the full current lockfile audit.

## Known limitations preserved as gates

- Synthetic staging still trusts the development Auth0 issuer; dedicated staging and production
  tenants and replay remain D6 requirements.
- Shared environments remain synthetic-only. Real candidate onboarding still requires deployed
  notice, rights, export/deletion, identity, provider, and incident-operating evidence.
- Incident and vulnerability procedures exist, but public monitored channels, named staffed roles,
  response objectives, and exercises remain real-data/public-release gates.
- Subprocessor reviews, real AI processing, public source ingestion, UGC, browser extension,
  ATS actions, remote browser, outreach, billing, mobile, and each new jurisdiction/provider remain
  blocked by their owning delivery.
- No representative authorized provider fixture exists; D0-007 remains open.
- The two exact mobile-build dependency exceptions remain time-bounded and must be removed or
  explicitly re-reviewed before their recorded expiry.
- ADR-015's independent exact-launch-candidate assessment, remediation, retest, and signed release
  disposition remain mandatory in D6.
- ADR-019 defers counsel review to D6-016; this pre-audit makes no legal conclusion.

## Engineering disposition

The reviewed technical evidence is sufficient to present the synthetic-only foundation to the
independent D6-015 reviewer. Engineering recommends `Approved with conditions` only if the reviewer
inspects the inherited manifest and exact launch candidate, accepts the limitations above as
blocking gates, records any additional findings, and provides traceable disposition and retest
evidence. No residual risk or release permission is accepted by this engineering record.
