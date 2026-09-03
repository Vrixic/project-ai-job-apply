# ADR-029: Use one explicit public-job addition command in the extension

Status: Accepted
Date: 2026-09-03
Supersedes: ADR-028 decision 1 and its separate-checkbox presentation requirement only

## Context

The installed Phase 2 extension presented both a private save and a public contribution path, then
required a second checkbox before the public action. The intended extension product is narrower:
it captures selected fields from a job posting already available on the public internet and asks
the user to add those fields to the shared job database. Showing an unrelated private-save path and
asking twice for the same public-add instruction made that purpose harder to understand.

Public availability does not make a page trustworthy, current, correctly licensed for every use,
or safe to publish automatically. It also does not remove the platform's need for idempotency,
attribution, withdrawal, abuse controls, or an auditable record of the command. The existing v1
API calls that immutable record a contribution consent.

## Decision

1. The extension presents one delivery action: **Add job to shared database**. It does not present
   the implemented private saved-page transport in this release candidate.
2. The add button is the user's explicit instruction to send the selected public fields. The UI
   does not require a redundant approval checkbox.
3. Before the button is enabled, the extension shows the exact sanitized preview, keeps required
   source identity visible, permits removal of optional fields, and explains any delivery gate that
   is not ready.
4. The background transport continues creating the existing immutable, payload-digest-bound v1
   Profile record. In this workflow it is an internal command-authorization receipt used for
   integrity, replay safety, owner attribution, revocation, and withdrawal. It is not presented as
   permission to read a publicly accessible posting. Renaming the public contract is deferred to a
   separately versioned compatible API change.
5. Contribution remains authenticated, signed-policy-gated, idempotent, independently verified,
   moderated where required, deduplicated, provenance-preserving, withdrawable, and default-dark.
   A click never makes the submitted fields unquestioned catalog truth.
6. Location and work type are separate grounded fields. Exact structured values and exact supported
   provider markup may supply work type. A combined value such as `Remote-NORAM` is separated into
   work type `Remote` and location `NORAM`; unknown values are not invented.
7. The private saved-page API and transport remain backward compatible for existing clients and
   data-rights handling, but the Phase 2 extension creates no private-save intent from its UI.

All other ADR-028 decisions remain in force, including current-tab-only inspection, the strict
field allowlist, zero normal raw-page retention, Jobs/Trust ownership, independent provider truth,
account fencing, kill switches, and accountable release gates.

## Consequences

- The installed workflow has one clear destination and one explicit delivery command.
- Store, privacy, security, accessibility, test, and delivery documentation must describe the
  public-add-only surface while distinguishing its internal authorization receipt from page-access
  permission.
- Existing server contracts and persisted records do not require a breaking migration.
- Removing the private control does not delete existing private captures or weaken their export,
  deletion, or owner-isolation requirements.
- Accountable legal/privacy/store review is still required before public distribution; this
  engineering decision does not self-certify those external gates.

## Alternatives

- **Keep private save and public contribution side by side.** Rejected for this extension release
  because private save is not part of the requested workflow and obscures the shared destination.
- **Keep a separate contribution checkbox.** Rejected because the labelled add button already
  expresses the same command after an exact preview.
- **Remove the server authorization record.** Rejected because it would weaken digest binding,
  replay safety, attribution, revocation, and withdrawal and would require a breaking contract and
  persistence redesign.
- **Infer work type from arbitrary prose.** Rejected because it could invent or misclassify a job
  fact; only exact structured or supported combined-field evidence is accepted.
