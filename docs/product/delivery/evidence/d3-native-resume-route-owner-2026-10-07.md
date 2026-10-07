# D3 resume route owner integration - 2026-10-07

D3-064/D3-079 remain In progress. The private preparation control and original durable
execution now compose the route lifecycle. All new runtime switches default off.

## Implementation

The Documents owner admits only the original active candidate, application preparation,
current job context, unsealed allocation and available original source. Capture checks admission
before and after the original ECS/EC2 address read without holding SQL locks across AWS calls.
The strict private contract adds route capture, admission and stored retirement metadata.
Recovery reads remain available independently of current candidate admission.

The durable preparation execution captures original readiness, creates and observes DNS, repeats
owner admission before packet attachment, and cleans up after original expiry or positive stored
retirement. Attachment uses checkpoint-before-execution with no retry: an interrupted attachment
remains unresolved while cleanup continues, since successful attachment changes the preparation
revision and cannot safely repeat the preceding admission check.

Control configuration requires `NATIVE_RESUME_ROUTE_OWNER_ENABLED=true` and strict
`NATIVE_RESUME_ROUTE_CONFIGURATION_JSON` containing `hostedZoneId` and `baseHost`, with public-IP
launch enabled. The durable runtime separately requires `NATIVE_RESUME_ROUTE_LIFECYCLE_ENABLED`
and `NATIVE_RESUME_ROUTE_CREATION_ENABLED`. Numeric versions and warm configuration remain pinned.
Updated private receivers must precede callers; existing versions reject the additional actions.

## Local verification

- Documents and Workflows TypeScript builds pass; Biome checks all 12 changed TypeScript files.
- 86 contract, DNS and address tests plus 24 durable/lifecycle tests pass.
- 64 integration tests pass against a fresh disposable PostgreSQL 16.6 database. They cover
  admission changes, source holds, job revisions, candidate quarantine, foreign scope, and
  compiled control capture/admit/attach/retirement with simulated ECS/EC2 responses.
- Eight emitted bundle isolation/default-off tests pass.
- An earlier rerun reused a database with a pending fixture and failed one dispatcher assertion;
  resetting only the disposable fixture produced the clean 64-case pass.

Logs: `.tmp/d3-resume-route-owner-{documents,build,contract-tests,workflow-tests,sql}.log`.
These are local checks with simulated AWS, not managed DNS, TLS download or browser acceptance.
No fresh full verifier or dependency audit was run; previous dependency findings remain open.

## Remaining launch work

Terraform still needs the route configuration, exact DNS permissions/network access and execution
budget covering the full 1,800-second lifetime plus propagation/cleanup (currently 900 seconds).
Hostname/zone choice, TLS/ingress, terminal unresolved-work reconciliation and managed download
acceptance remain. ADR-040 remains Proposed. No cloud publication, deployment, activation,
frontend or CI/CD changes. D1 and D3 are incomplete; the PC remains on.
