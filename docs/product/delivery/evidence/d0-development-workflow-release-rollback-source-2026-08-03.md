# D0-016 development workflow release rollback source evidence

- Date: 2026-08-03
- Environment: development preparation only
- Status: Source and local validation implemented; no rollback plan or AWS mutation performed
- Runbook: [Development serverless workflow release rollback](../../../../infrastructure/runbooks/deployments/development-serverless-workflow-release-rollback.md)

## Implemented boundary

The release coordinator reconstructs the current and rollback workflow artifact inputs from two
retained reviewed Terraform plans below the development `.terraform` directory. It rejects equal
releases and plans that differ in the gateway artifact or pinned extension boundary. It delegates
both reverse and forward semantic validation to the existing strict workflow release planner,
which accepts only 14 exact in-place updates plus the policy-hash propagation-gate replacement and
rejects every create, delete, routing, trigger, ECS-capacity, or Temporal-dispatch change.

Each apply requires the exact separately reviewed saved-plan SHA-256 and `-Execute`. Before an
apply, the operator requires clean synchronized `main`, the exact temporary development caller,
unchanged retained plan sources, and zero drift for the source release. After an apply it requires
zero drift for the target release. Restoration is blocked until rollback conformance is explicitly
confirmed; cleanup is blocked until restored-release conformance is explicitly confirmed.

The ignored context and plan copies remain local. The source does not embed an account identifier,
state bucket, artifact key/version, ARN, credential, secret, payload, log, or candidate data.

## Local validation

- PowerShell parser validation passes.
- `-Help` and read-only empty-context `Status` execute successfully.
- Retained plan input extraction accepts an exact root-variable reference only when the saved
  plan's matching top-level variable value exists; unrelated or missing expressions fail closed.
- Release preflight treats an omitted alias `RoutingConfig` as the expected unweighted alias
  posture, normalizes the optional collection to an always-array value under strict PowerShell,
  and still rejects any actual additional version weight.
- Release preflight treats an omitted Lambda `Layers` property as an empty layer collection under
  strict PowerShell while continuing to require the pinned extension layer on functions that use it.
- Retained-state parsing treats an omitted Terraform `index_key` as an unindexed resource while
  retaining exact string and numeric address reconstruction for indexed resources.
- Expected Terraform create, update, and replacement address sets are normalized to arrays in
  every planner mode, including the valid empty-set cases used by release and verification plans.
- Repository whitespace validation passes.
- The existing strict planner remains the only component that constructs or semantically accepts
  a Terraform release plan.

No successful AWS API read, Lambda invocation, Terraform plan/apply, trigger change, route change,
ECS resume, or product-data write is claimed. After merge, a fresh read-only reverse plan from
exact `main` and a separate checksum authorization are required.
