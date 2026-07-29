# ADR-006: Contract-First Compatibility

Status: Accepted
Date: 2026-07-28

## Decision

Author REST APIs in OpenAPI 3.1 and events in JSON Schema before implementations. Generate clients
and transport types, validate payloads at runtime, version event names, and block incompatible
changes in CI. Events use a CloudEvents-compatible envelope and contain minimal identifiers.

## Consequences

Consumers can upgrade independently and inspect changes before deployment. Generated code is never
hand-edited.
