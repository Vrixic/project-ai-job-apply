# ATS SDK

Defines the contract and safe reusable utilities used by extension and backend ATS adapters.

## Planned subfolders

- `contract/` — Detect, inspect, map, fill, validate, submit, and confirm interfaces.
- `capabilities/` — Adapter capability declarations.
- `dom/` — Accessible labels, widgets, shadow DOM, and safe selectors.
- `fields/` — Ontology mapping helpers.
- `results/` — Structured per-field and per-step outcomes.
- `telemetry/` — Adapter metrics without field values.
- `testing/` — Fixture harness and adapter conformance suite.

Provider-specific behavior belongs in its adapter folder; the SDK remains provider-neutral.

## Current D3 slice (source and local verification only)

Provider-neutral only. `extractGenericForm` reads standard form structure; `formStructureHash` binds packets to the form; `mapFormFields` maps controls to taxonomy keys and refuses ambiguous claims; `buildFillPlan` plans only approved values and hands attestations, signatures, unmapped, and unmatched controls to the candidate; `planAssistedManual` is the no-action fallback for unknown sites; `AdapterRegistry` keeps every adapter off unless its kill switch is on, live ATS effects are approved (D3-012), and unexpired QA-accepted provider-derived fixture evidence covers the exact variant (ADR-021). Greenhouse, Lever, and Ashby adapters are declared with no supported variants until D3-013 supplies authorized fixtures.

D3-082 fails closed on conflicting taxonomy claims within a control or across controls and on
duplicate normalized option labels. A detected challenge produces only candidate-action steps.
Restricted authorization/demographic/disclosure fields require direct candidate action even when
the approved packet carries an answer, matching D3-013's adopted zero-sensitive-fill threshold.
These synthetic SDK checks do not establish provider fidelity or live acceptance.

Extraction refuses an oversized form rather than returning a prefix: at most 200 fields, 250
options per control and 300 normalized characters per label/name/option. Combined accessible
labels also obey the text bound. `extractGenericForm` throws a fixed, content-free `RangeError`;
callers must stop planning and leave completion to the candidate. Radio grouping includes every
member within the bounds and preserves requiredness from any member, including the last field.
The default-off manual question capture invokes the extractor as a self-contained top-frame
function. Label resolution excludes text inside controls, including initial textarea contents.
Browser-safe subpaths expose extraction, mapping and canonical structure inputs without Node crypto.
The observed-form envelope parser rejects unknown fields, values, oversized input, challenges and
expired/future captures. This is candidate-controlled metadata, not authorized provider evidence.
See [ADR-046](../../docs/adr/046-observed-form-saved-answer-selection.md).
