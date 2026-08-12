# Consent Model

- Status: Engineering baseline; product decisions and counsel approval pending
- Last updated: 2026-08-11

Consent records are immutable and versioned. A correction, revocation, or renewed approval appends
a new record rather than rewriting history.

Each record must identify:

- Internal user ID
- Purpose and narrowly defined action
- Consent-document/version identifier
- Resource or packet identifier and immutable hash when applicable
- Client and interaction surface
- UTC timestamp and expiry, if applicable
- Superseded/revoked consent identifier, if applicable

Separate consent is required for profile data, public UGC contribution, application preparation,
application submission, sensitive answers, remote-browser takeover, and each outreach send.

Consent does not cascade:

- Saving a private job is not consent to contribute it publicly.
- Preparing an application is not consent to submit it.
- Approving one packet does not approve a materially changed packet.
- Connecting an email account for sending is not consent to read inbox or calendar data.
- Product use is not consent to expose a candidate profile to employers.

## Current implementation boundary

The deployed synthetic Phase 0 slice authenticates a user and requires an explicit preference-save
request, but it does not implement the complete immutable consent ledger, terms/privacy-version
acceptance, export/deletion rights flow, restricted-answer vault, public contribution, provider
disclosure, application-packet approval, or any irreversible external action. Authentication and
an API request are not substitutes for the purpose-specific consent records defined here.

Real candidate onboarding remains blocked until the applicable notice/terms acceptance, consent
evidence, correction/export/deletion controls, and accountable legal/privacy and security
conditions are implemented and tested. Later deliveries must distinguish product authorization
from any legal basis or notice obligation determined by counsel; this engineering model does not
declare that consent is the legal basis for every processing purpose.

## Purpose and action matrix

| Purpose/action | Required user action | Expiry or invalidation | Revocation effect |
|---|---|---|---|
| Accept current terms/privacy notice | Explicit acceptance of identified versions | Material notice/terms change as counsel requires | Does not erase completed lawful actions; may require account closure if essential terms are rejected |
| Store profile facts/preferences | Explicit onboarding/entry plus visible correction controls | Until corrected, withdrawn, or account deleted | Stop optional processing and apply retention/deletion policy |
| Share data with an AI provider | Just-in-time approval for the declared preparation purpose or an approved persistent setting | Provider/purpose/data-category change or withdrawal | No new disclosure; delete provider-held data when applicable |
| Save a private job | Explicit save | User removal/account deletion/job tombstone rules | Remove private association |
| Contribute public job data | Separate preview and explicit contribution | Material payload/source/license change or withdrawal where supported | Remove contributor association and process public-content removal under approved policy |
| Prepare an application | Explicit request for identified job/profile inputs | Material job, form, fact, answer, or document change | Stop preparation; preserve only policy-authorized audit state |
| Store/reuse a restricted answer | Candidate supplies the value and explicitly chooses to save it | Answer change, context mismatch, expiry, or withdrawal | Prevent reuse and delete according to restricted-data policy |
| Submit an application | Explicit approval of immutable packet hash and destination | Any material packet/form/destination change; single use | Cannot undo a confirmed external submission; stops pending attempts |
| Start remote-browser/takeover session | Explicit session action | Short session timeout, task completion, or material redirect/change | Terminate session and destroy delegated session material |
| Connect send-only email | Explicit OAuth connection with displayed scopes | Scope/provider change, disconnect, credential expiry | Revoke token and stop sends; never grants inbox/calendar access |
| Send outreach | Explicit recipient/content/account/time approval per send | Any content/recipient/account change; single use | Stops pending send/follow-up; cannot recall delivered mail |
| Optional analytics/marketing | Separate choice where required | Purpose/vendor/technology change or withdrawal | Stop future optional collection and queue applicable deletion |

## Sensitive and irreversible actions

- Demographic, disability, veteran, health-related, sponsorship, work-authorization, criminal-history,
  legal-consent, signature, and attestation fields are never inferred.
- User-supplied restricted answers may be stored in the dedicated restricted vault. Every use must
  be visible during final application review and approved as part of that application's immutable
  packet.
- Submission, outreach sending, account deletion, public contribution, and credential connection
  require a visible final action with clear destination and effect.
- A CAPTCHA or MFA challenge is a user-takeover boundary, never an authorization to bypass it.

## Revocation and evidence

- The service checks the latest applicable consent state before beginning and immediately before an
  external side effect.
- Revocation prevents queued or retried work from using superseded consent.
- Consent evidence contains opaque resource identifiers and hashes, not copied candidate values.
- If a completed external action cannot be reversed, the UI and consent record must say so before
  approval.
- Failed or ambiguous consent checks fail closed and route to user review.

## Open decisions and approval

| Decision | State |
|---|---|
| Minimum user age and any age-verification control | Product decision: 18+; implementation and counsel review pending |
| Restricted-answer storage/reuse policy | Product decision: dedicated vault plus mandatory per-application final review; implementation and approval pending |
| Optional analytics consent model | Product decision: no optional analytics in Phase 0; later explicit preference and counsel review |
| Required terms/privacy reacceptance triggers | Counsel required |
| Consent withdrawal and legally required retention exceptions | Counsel required |

Approval is recorded in the
[Phase 0 security/privacy approval plan](security-privacy-approval-plan.md), not inferred from this
engineering baseline.
