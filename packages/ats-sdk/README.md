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
