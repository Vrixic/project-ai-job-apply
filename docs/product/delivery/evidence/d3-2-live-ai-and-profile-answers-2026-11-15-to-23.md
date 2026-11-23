# D3.2 evidence: live AI sitting and profile answers, 2026-11-15 to 2026-11-23

Development account, us-east-2. Synthetic and owner-consented test data only; no generated content
is reproduced here.

## Live generation (D3.2-002 to D3.2-005), 2026-11-15

| Check | Result |
|---|---|
| Bedrock invocation logging | Off, verified with `scripts/verify-bedrock-invocation-logging-off.ps1`. |
| Live resume tailoring | Proven through the deployed web app: one Bedrock call (2,802 input, 381 output tokens), selection-only output passed the factuality gate. |
| Live cover letter | Proven end to end on native-material task revision 3: generation, grounding check, page display (four grounded paragraphs). Three defects found and fixed during the sitting (#859, #860, #861). |
| 30-minute expiry | Cover-letter task started 20:50:51 EST and was stopped by the kernel deadline at 21:21:07 EST (exit 137). Its DNS record was removed, and the page said the letter had expired and been deleted. The generated-resume page showed the same expiry notice. |
| Kill switch | OFF removed the five task-role grants: the cover-letter task's `bedrock:Converse` was denied (CloudTrail) and produced no letter, while a resume still generated deterministically. ON restored them. Both states were applied and verified at zero drift. |
| Cost | 44 invocations, 104,727 input and 30,000 output tokens, about $0.76 against the $20 monthly ceiling. |

Not covered by this sitting: the browser and ATS copies of an applied application. They belong to
the connected journey (D3.2-006), which needs the owner to approve and submit.

## Jev choice answers (D3.2-010 to D3.2-013), 2026-11-19

- `choice_answers_enabled` applied. The owner put the TypeSafe key in the secret. Choices work on
  Ashby and Greenhouse (#876). The owner confirmed a live in-person question on an Ashby posting.
- Threshold calibration is deferred by the owner ("leave tuning work for later").

## Profile answers for recurring questions (D3.2-014 to D3.2-016)

| Date | Change | Release |
|---|---|---|
| 2026-11-19 | ADR-062 slices 1 to 3 (#878 to #880): Profile migration 0015, new profile fields, packet rows, planner patterns, Jev context, stricter Apply check. | Migration image `sha256:91b44164...` executed and verified (9 events); Gateway alias 171 applied and verified; web redeployed. |
| 2026-11-20 | Minimal Profile tab header (#881). | Web. |
| 2026-11-23 | ADR-062 amendment (#882): Sensitive answers tab removed; its questions became choices on the Screening tab and a new Equal employment tab, stored as ordinary saved answers; Jev reads them; the obsolete screening-required switch removed, so authorization, sponsorship and work countries are required before Apply. | Refresh-only state update (database restore time, S3 endpoint ranges), then Gateway from `50858915` applied and verified with no drift; web production ready. |
| 2026-11-23 | Every Profile field that can be a choice is one (#883): country, state or province, pronouns, languages, skill category, notice period, currency. | Web production ready (`bf32eba7`). |

The web unit tests run again since #882 (`frontend/web/vitest.config.mts`). Two timer tests
(`job-detail-view`, `saved-jobs-panel`) fail and are tracked as a follow-up.
