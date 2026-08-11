# D0 Staging On-Demand Direct-State Acceptance — 2026-08-11

## Decision

The product owner accepted the already proven direct AWS/Terraform dormant-state evidence as the
completion boundary for D0-017 and removed the additional billing-lag observation from Phase 0.
The cost observation was redundant evidence, not a runtime control: staging had already completed
the full dormant → active → accepted → dormant replay and final inspection showed zero disposable
data-plane resources.

This decision does not claim that dormant staging costs exactly `$0`. Retained KMS, secrets,
artifacts, logs, queues, budgets, exports, and state can accrue small control-plane costs. It accepts
that the hourly RDS instance and three VPC interface endpoints cannot accrue future usage while the
corresponding resources are absent.

## Evidence retained

- The first shutdown deleted the synthetic RDS instance and all three interface endpoints through
  separately checksum-reviewed plans.
- The complete activation drill recreated the exact dark data plane, migrated it, passed
  authenticated persistence, durable readiness, two-account denial, 500/500 public probes, 25/25
  workflows, AWS corroboration, and zero drift.
- Separately reviewed traffic-disable, quiescence, and dormancy plans returned staging to no RDS,
  managed interface endpoint, public route, enabled trigger, queued work, or running ECS task.
- Remote state retained 119 control-plane resources and zero disposable resources.
- The explicit dormant-cost inspector correctly rejected the known August 10 transition day after
  finding 20.2028 RDS instance-hours and 61 VPC endpoint-hours, proving the usage detector remains
  available for optional financial reconciliation.

## Consequence

D0-017 is complete on direct state and lifecycle evidence. The dormant-cost command remains a
read-only optional operating check and is not a Phase 0 exit gate. Accountable legal/privacy,
security/privacy, and representative ATS fixture gates remain unchanged. Synthetic-only D1
implementation may start under ADR-011; no real source ingestion, public UGC, real candidate data,
or external application action is authorized.

No AWS resource, Terraform state, data, identity, or configuration changed for this decision.
