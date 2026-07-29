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
