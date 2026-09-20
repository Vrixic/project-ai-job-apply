# D3-013 Provider Fixture Request (Greenhouse, Lever, Ashby application forms)

- Status: Prepared for human action. Nothing here is authorized, acquired, or accepted. On 2026-09-19 the product owner adopted the proposed variant matrix and acceptance thresholds below as written (owner statement); every human step below is still open.
- Task: D3-013 (blocks D3-007 and the last D3 exit criterion)
- Governing records: [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md),
  [ATS fixture policy](ats-fixture-policy.md), fixture metadata schema
  [`fixture-metadata.v1.schema.json`](../../../packages/test-fixtures/ats/fixture-metadata.v1.schema.json)
- Prepared: 2026-09-18

Synthetic fixtures prove tooling only. They can never satisfy this gate, and the adapter registry
already rejects `synthetic` evidence. No live form was fetched, scraped, or automated to prepare this
request.

## What only a human can do

1. **Choose the supported variant matrix** (QA/automation with the capability reviewers). A proposed
   starting matrix is below; adopt, shrink, or replace it. An adapter can only ever cover variants that
   appear in accepted evidence.
2. **Authorize each capture source** with a written record for the exact capture, sanitization,
   storage, and testing purpose (allowed inputs are listed in the fixture policy; user-provided pages
   need specific recorded consent).
3. **Capture and sanitize** under the fixture policy, then record the secret/PII scan pass and the
   human sanitization review.
4. **Accept representativeness** in a separate QA review (not the author of the capture).
5. **Record raw-capture destruction or compliant quarantine.**

## Variant matrix (per provider; adopted by the owner 2026-09-19)

| # | Variant | Why it matters |
|---|---|---|
| 1 | Standard hosted application form (contact fields, resume upload) | Baseline field mapping and file attach |
| 2 | Custom questions: text, textarea, select, radio, checkbox | Exact option matching and unmapped-required handling |
| 3 | Voluntary self-identification section (gender, race/ethnicity, veteran, disability) | Sensitive fields must never be filled silently |
| 4 | Work-authorization and sponsorship questions | Restricted answers and ambiguous legal wording |
| 5 | Certification/acknowledgement checkbox and any signature field | Direct candidate action |
| 6 | Challenge step (CAPTCHA/anti-automation) | Takeover, never bypass |
| 7 | Provider validation-error state | Rejection classification and no-blind-retry behavior |
| 8 | Confirmation/success state | Confirmation evidence without storing page bodies |
| 9 | Embedded/iframe-hosted form | Extraction boundaries |

## Acceptance thresholds (adopted by the owner 2026-09-19)

Exit criterion 5 requires "agreed field accuracy and confirmation thresholds". Adopted by the owner:

- Field mapping: at least 98% of exact-match required fields planned correctly across accepted
  variants, and 0 sensitive, attestation, or signature fields ever planned as a fill.
- Option handling: 0 coerced-to-nearest selections.
- Confirmation: 100% of accepted confirmation fixtures detected and 0 false confirmations on
  non-confirmation fixtures.
- Failure handling: 100% of validation-error and challenge fixtures routed to review or takeover.

## Evidence record to complete per adapter and variant

| Field | Value |
|---|---|
| Provider / adapter id | |
| Variant id (must equal the registry variant) | |
| Source and authorization record id | |
| Capture date and method | |
| Sanitization scan passed at | |
| Human sanitization review by | |
| QA representativeness accepted at / by | |
| Evidence expires at | |
| Raw capture destruction or quarantine record | |

When a record is complete, add it to the deployment controls as `FixtureEvidence` with
`kind: "provider_derived"` and declare the variant on the adapter. The adapter stays off until
[D3-012](../../security/d3-application-approval-packet.md) also approves live ATS effects and its kill
switch is turned on.
