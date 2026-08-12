# ADR-021: Own provider fixtures with adapter deliveries

Status: Accepted
Date: 2026-08-12

## Context

Phase 0 established a versioned ATS-fixture policy, intake and manifest templates, a fail-closed
metadata/integrity validator, regression tests, and an executable synthetic fixture. That work
proves the repository safety process, but it cannot determine which real provider variants are
representative before the corresponding detection, form, or remote-browser capability is defined.

Treating provider-derived fixtures as a Phase 0 completion gate would either select variants
prematurely or invite a false representativeness claim. Synthetic evidence also cannot substitute
for authorized provider evidence.

## Decision

D0-007 is complete when the fixture acquisition/sanitization process and its automated repository
gate are implemented and tested with synthetic material. Authorized provider-derived fixture
acquisition and independent QA representativeness acceptance are blocking tasks in the delivery
that owns each adapter surface:

- D2 owns Greenhouse, Lever, and Ashby job-page detection variants.
- D3 owns Greenhouse, Lever, and Ashby application-form/autofill variants.
- D4 owns Workday tenant, account, widget, and application variants.

Each owning delivery must define its supported variant matrix, obtain explicit authorization for
the exact capture/sanitization/storage/testing purpose, pass secret and PII scans, complete human
sanitization review, obtain separate QA representativeness acceptance, and record raw-capture
destruction or compliant quarantine evidence before the affected adapter can be activated.

The repository validator remains fail closed. A synthetic fixture never counts as provider
evidence, and a provider fixture never authorizes production ingestion, automation, submission,
redistribution, or another provider/variant.

## Consequences

- Phase 0 can close without claiming that representative provider fixtures exist.
- D2, D3, and D4 cannot complete or activate affected adapters without their explicit fixture
  tasks and exit criteria passing.
- Authorization expiry, revalidation, provider-layout changes, or failed review disables the
  affected fixture and adapter until the owning delivery restores valid evidence.
- Capability-specific legal, privacy, security, provider, and external-action gates remain in
  force; this ownership transfer does not approve any source or provider behavior.

## Alternatives

- **Require provider fixtures in Phase 0.** Rejected because supported variants and behavior
  coverage belong to concrete adapters and are not yet defined.
- **Use synthetic fixtures as representative evidence.** Rejected because synthetic material
  cannot prove fidelity to a provider variant.
- **Acquire fixtures opportunistically without a delivery gate.** Rejected because provenance,
  authorization, sanitization, representativeness, expiry, and deletion evidence must be
  enforceable release conditions.
