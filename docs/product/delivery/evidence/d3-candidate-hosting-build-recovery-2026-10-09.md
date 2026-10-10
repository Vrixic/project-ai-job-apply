# D3 candidate hosting build recovery — 2026-10-09

The candidate Vercel build failed because its upload omitted existing frozen-install security
patches. After that repair, the real preview exposed a second missing input: the ATS SDK used by
D3 form review. Both failures are fixed in [PR #617](https://github.com/Vrixic/project-ai-job-apply/pull/617).

The closed upload boundary now includes exactly the three existing reviewed patches and the ATS
SDK production source. The operator verifies each patch's manifest declaration, tracked regular
file, reviewed SHA-256 and canonical lockfile binding. Omission regressions cover the patches and
both ATS SDK upload rules. The full repository verifier now runs the previously omitted hosted
operator regression suite.

Verified against `5e94a61b2825ebad651f4d41b0f956160b70423e`:

- Focused tests pass in PowerShell 7 and Windows PowerShell, with independent source review.
- The real Vercel dry-run contains 203 files, exactly three patches and nine ATS SDK build inputs.
  All five frontend/workspace manifests have complete runtime workspace dependency closure;
  credentials, test evidence, artifacts and unrelated workspaces remain excluded.
- The candidate Vercel preview completes frozen installation and Next.js compilation successfully.
- All 42 repository verification stages pass. The first attempt stopped because Biome ignored the
  worktree's `.tmp` ancestor; relocation and frozen dependency relinking fixed the local environment.
  The complete rerun passes without changing or bypassing any checker.
- Three fresh real Chromium journeys pass: search → Prepare → review → approve → manual Apply →
  candidate-confirmed history; extension handoff/saved-answer selection; and withdrawn-answer
  recovery. Authentication, API and native responses are synthetic. No live generation or employer
  submission occurred. Existing truthfulness, sensitive review, immutable approval and expiry
  controls remain in place.

GitHub hosted jobs did not start because of account payment/spending limits; they are not passing
CI evidence. A successful preview build does not establish stable-host identity, native/CORS,
installed-extension, provider or full candidate-journey acceptance. Independent D1 and hosted admin
acceptance remain deferred. D3 stays In progress behind its documented live and accountable gates.
