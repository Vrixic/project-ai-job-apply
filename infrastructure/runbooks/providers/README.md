# Provider Runbooks

Contains reviewed procedures for dependency interruption, fail-closed behavior, service
continuity, and recovery. Provider drills use only synthetic development identities and
environment-scoped controls.

## Current procedures

- [Development Auth0 recovery](development-provider-and-log-recovery.md) — Exercises a fresh Auth0
  login interruption and proves bounded recovery without retaining identity data. Its stable path
  is preserved for deployed CloudWatch links; the retired ECS log-heartbeat drill is not restored.
