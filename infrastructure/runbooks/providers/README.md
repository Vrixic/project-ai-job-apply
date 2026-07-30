# Provider Runbooks

Contains reviewed procedures for dependency interruption, fail-closed behavior, service
continuity, and recovery. Provider drills use only synthetic development identities and
environment-scoped controls.

## Current procedures

- [Development provider and log recovery](development-provider-and-log-recovery.md) — Exercises
  fresh Auth0 login interruption separately from CloudWatch gateway-log delivery and proves
  bounded recovery without retaining identity or log payloads.
