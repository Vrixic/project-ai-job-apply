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
