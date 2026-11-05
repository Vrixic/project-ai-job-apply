# ADR-010: Restricted Answer Vault and Mandatory Review

- Status: Accepted as product direction; legal/privacy and security approval pending
- Date: 2026-07-28

## Context

Repeatedly entering voluntary demographic, disability, veteran, sponsorship, work-authorization,
legal, and similar answers creates friction. These values can also be unusually sensitive, become
stale, or cause material harm if inferred or applied in the wrong context.

## Decision

The platform may store a value only when the candidate supplies it and chooses to save it. Stored
restricted answers:

- live in a dedicated restricted-data boundary with separate encryption/key and least-privilege
  access;
- record provenance, answer context, version, user confirmation time, and any expiration;
- never enter logs, analytics, general events, fixtures, prompts unrelated to the approved
  application, or public/support views;
- are never inferred, silently transformed, or applied when the employer question is not
  semantically equivalent;
- are visibly included in every application's final review, even when unchanged;
- require approval as part of the immutable application packet before submission;
- invalidate packet approval when the value, question, context, destination, or artifact changes;
  and
- can be corrected or deleted by the candidate, with queued workflows prevented from using a
  superseded value.

CAPTCHA, MFA, signatures, attestations, ambiguous legal questions, and any answer without an exact
grounded match always route to direct user action.

## Consequences

Candidates can reuse truthful answers with fewer repeated clicks, but restricted fields never
become invisible “autopilot” values. D3 must implement dedicated storage, authorization, consent,
review, expiry/context matching, deletion/export, audit, and adversarial tests before activation.
Legal/privacy and security reviewers may impose narrower storage or reuse conditions.

## Amendment 2026-11-05: answers the candidate sets are ordinary answers

Owner direction: remove the concept of restricted answers; the extension uses the answers the
candidate has set to fill the application. What changed in this step:

- The fill planner and the extension no longer treat authorization, disclosure or demographic fields
  as "always the candidate's action". When the approved packet carries a value the candidate set, it is
  filled, including a Yes/No answer chosen from a custom dropdown, exactly or not at all. This
  supersedes the D3-013 threshold for those fields.
- Consent, signatures, challenges, CAPTCHAs, one-time codes and documents are not answers: they are
  never automated and never travel in the execution command.
- The candidate answers the screening questions (work authorization, sponsorship) once, in a Screening
  questions tab of the Profile, saved as ordinary saved answers. The Profile service no longer refuses
  those questions. Apply is held back by a popup, not an inline block, until the Profile has them and
  the other basics; the popup links to the first tab with something missing. An application sends the
  saved answers as the candidate's own entries and no per-answer check is asked for.
- A "No" to a United States question is not used for an employer question that also names another
  country, because it says nothing about that country.

Not changed yet, and needing a separate decision because it is data-affecting: the saved-answer vault,
its tables, encryption, and its parts of data export and account deletion. The vault tab is gone from
the Profile page and nothing new is written to it.
