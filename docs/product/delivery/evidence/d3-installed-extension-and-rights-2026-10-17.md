# D3 installed-extension and rights session - 2026-10-15 to 2026-10-17

D3 remains In progress. This session restored development from the encrypted October 14 snapshot,
found and fixed eight defects through the real installed extension and hosted app, and ran the
document-inclusive rights test once to its failure. Nothing here is accepted behavior: installed Chrome
checks used a synthetic disposable account and one real public Ashby posting, and the canonical
17-step rights run still has no success receipt.

## Restore and runtime

Fresh inputs selected `ai-job-apply-development-shutdown-20261014224151` for both the final and
restore selectors; the archived October 14 inputs were not changed. The reviewed restore plan created
physical database `db-G3JWKRKVOZMTIY443CFZ5P7AFE` (private, encrypted, protected, 35-day backups). Its
reader IAM policy matched the original with only the physical-ID substitution. An encrypted
`...-rights-primary-safety-20261015164947` snapshot was available before replay.

The completed-deletion replay (source `de62d753`, two byte-identical artifact builds) validated 3 completed
markers, found all 3 subjects already reconciled, and made no S3, ledger or identity-provider writes. Its
temporary executor, role and boundary allowances were removed and verified absent across 595 Lambda
function/version entries. Runtime stages (endpoints, NAT, scanner, native preparation) were applied one
reviewed plan at a time. Workflow version 16 had zero executions in all five statuses before the current
native version replaced it; the retained-version list was unchanged.

## Defects found and fixed (all merged with regressions and review)

| PR | Defect | Found by |
|---|---|---|
| #687 | Enabling the restore allowance grew the shared workload boundary to 6,333 characters; AWS refused (6,144 limit). One combined restore statement and a size postcondition. | Live apply refused; live default unchanged. |
| #688 | Saving a restricted answer with no context sent an empty KMS encryption-context value, which KMS rejects (HTTP 500). Empty context is now omitted in the vault and export ciphers. | Hosted save; confirmed with a direct KMS probe. |
| #689 | Extension capture/handoff required the exact canonical URL; Ashby/Lever forms live on `/application` or `/apply`. ADR-045 amended; one shared `employerPageForSource`. | Installed Chrome. |
| #690 | Question capture refused any page with a challenge; Ashby loads reCAPTCHA on every page. Owner direction: capture, then tell the candidate to complete the challenge and submit themselves. ADR-046 amended. | Installed Chrome. |
| #691 | `GET /v1/jobs/{id}` lacked `Cache-Control: no-store`, which the extension's strict reader requires. Gateway 120. | Diagnostic extension build (not committed). |
| #692 | A legend-less radio group was labeled by its first option, so no question mapped. Heading label fallback. | Real Ashby form. |
| #693 | Handoff rejected the native packet's `documents.resume` digest field. Only an exact bound artifact digest is accepted, and it is never copied. | Installed Chrome. |
| #694 | Rights sign-in rejected a fresh MFA token 2-3 seconds ahead of the local clock (`token_auth_time_future`). 30-second bounded future skew; staleness and the 15-minute lease unchanged. | Live rights session. |

## Installed Chrome results (synthetic account, real Ashby posting, nothing submitted)

Passed: search, Prepare, separate native sign-in, exact resume preview, review and approval, PDF and DOCX
downloads, question capture with the challenge recorded, saved-answer selection, approved handoff load,
email and sponsorship copy (with question/context confirmation), answer correction (extension refused the
stale answer; application moved to re-review), withdrawal (packet withheld, metadata-only reopen and
re-prepare without the answer), reuse in a new packet, and a truthful "not submitted" outcome (attempt
`taken_over`; no confirmation or history). Not tested: Edge, saved-answer expiry in the extension,
installed behavior after generated-material expiry beyond the observed refusal. The Greenhouse bridge,
live AI and employer submission were not run. Auth0 grants (`applications:read` on the extension client)
were owner-configured and are not recorded here.

## Rights lifecycle: not accepted

Plans for the fixed D3 policy (eight owners, `ResumeFixture`, `ApplicationsInventory`) were generated
read-only. The first Execute used the earlier quarantined identity by mistake and was refused at its
first read (403) with no mutation. The second Execute, for the new account, uploaded the fixture resume,
requested an export (202), then created, cancelled and confirmed a deletion (202 at 20:19:42Z). The
deletion workflow succeeded in about 2.5 seconds and the recovery marker is tagged `completed` at
20:19:45Z. The candidate export bucket and document bucket hold no object from the test, and all thirteen
queues are empty. The operator then returned only the generic `operator_failed_check_recovery` at about
20:19:59Z, so there is no success receipt and the canonical run remains FAILED. Not verified: SQL owner
state, export/grant-expiry, and Auth0 user deletion. The deletion M2M identity has only `delete:users`
(no read), so absence cannot be read; a later sign-in attempt reached the app, which refused all data
calls (quarantined), but that may be a social login recreating the same subject. Next step: surface the
operator's failing step, then read-only verification of owner SQL and Auth0 before another run. Never retry
the confirmed request.

## Shutdown (verified 2026-10-17)

Final snapshot `ai-job-apply-development-shutdown-20261017204046` and its `-safety` snapshot are
available and encrypted; automated backups are retained. RDS, NAT, EIP and interface-endpoint counts are
zero; API routes, enabled rules/mappings, ECS tasks, durable executions and all queues are zero. Docker/WSL
are off, ports 3000/55432 are free, and the PC is on. The 144 dormant inputs are archived encrypted at
`recovery/development-dormancy/20261017204046/inputs.json` (SHA-256 `0b4b0f96...e61ba`). The final plan has
zero resource/data/output changes and 177 passing checks. Staging was not accessed. For a future restore,
create NEW inputs selecting `ai-job-apply-development-shutdown-20261017204046` for BOTH selectors.
The stable candidate alias is on an automatic `main` deployment without the D3 test flags.

## Still open

Live AI (no qualifying 30-minute all-copy provider policy), authorized Greenhouse fixtures and
exact-variant authority, canonical rights acceptance, production generation-cleanup quiescence proof,
installed Edge and expiry checks, and accountable acceptance. Hosted CI executed zero steps (billing);
all checks were targeted local runs.
