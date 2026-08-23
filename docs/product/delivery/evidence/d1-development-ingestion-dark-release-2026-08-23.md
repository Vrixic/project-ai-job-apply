# D1 Development Ingestion Dark Release

Date: 2026-08-23  
Environment: synthetic development  
Source: `bb33b85bd2b99624b20594ca53d20d5934c107db`

## Outcome

The generated-synthetic ingestion data plane is dark-deployed in development. Its durable
orchestrator, four transport/activity functions, two encrypted queues, two EventBridge rules,
disabled SQS mapping, least-privilege roles and policies, and fourteen alarms now exist without
activating ingestion.

Both ingestion enable switches remain false. The schedule rule, terminal rule, and dispatch queue
mapping are disabled; both queues are empty. No real provider configuration, credential, request,
job data, public route, or continuously running compute was introduced.

This closes the D1-003 artifact-publication and dark-infrastructure deployment gap. It does not
complete D1-003: provider/legal approvals, reviewed real company configuration, separately
authorized activation, real-provider network evidence, and live dynamic kill-switch acceptance
remain open.

## Build and publication evidence

- The exact source passed the workflows build and test suite and the centralized dependency audit.
- Two independent builds produced identical archives.
- Durable archive SHA-256:
  `cca9eeeefbc7901d0d6743ac717f2402e91ff2dff426cfd21646282c64382210`.
- Runtime archive SHA-256:
  `1aeb33471bfa6985fb316ce93c59b6b07241321875515a944750ecd1eaf67914`.
- The builder verified `index.handler`, `index.coordinator`, `index.starter`, `index.activity`, and
  `index.terminal` exports.
- Eight ZIP, SBOM, manifest, and checksum objects passed immutable version-bound publication,
  customer-managed KMS encryption, checksum, metadata, and readback checks.
- Publication receipt SHA-256:
  `97e4bb6df118e3936c96c17dd987cf3b561427040b8e8e647ca0f7c4408a4b82`.

The repository's reviewed dependency-audit command passed. A raw package-manager audit also saw
the already governed, unrelated Expo/mobile `image-size` advisories for which no patched version
was available; the central audit policy rejected no new High-severity dependency finding.

## Terraform and live evidence

- Saved apply-plan SHA-256:
  `b686207bad978f4530e9dea77e6ec65cd4a97fac3301c2eb80f6ba0253dca2c6`.
- The plan contained 45 ingestion creates, five expected updates, and zero deletes. The updates
  were limited to the ingestion activation guard and exact ingestion additions to the shared KMS,
  Lambda endpoint, Secrets Manager endpoint, and SQS endpoint policies.
- `deploy_ingestion_runtime=true`; `ingestion_runtime_enabled=false`; and
  `ingestion_synthetic_source_enabled=false` in the applied plan.
- Development advanced to state serial `145`.
- Five aliases point to exact numeric versions with no weighted routing. All five functions match
  their exact artifact hash and have reserved concurrency `1`. The four database-connected
  functions use the already reviewed Parameters and Secrets extension layer version `114`; the
  durable orchestrator has no Secrets Manager dependency.
- Both EventBridge rules and the sole event-source mapping are disabled.
- The encrypted dispatch and dead-letter queues retain for 4 and 14 days respectively and had
  zero visible, in-flight, or delayed messages at readback.
- The durable CloudFormation stack is complete, all fourteen ingestion alarms are `OK`, and ECS
  has zero services, desired/running/pending tasks, or listed tasks.
- Final refresh-backed zero-drift plan SHA-256:
  `13db8b2f3364c56b079d9a89226d5b00d96c952a0c2db57555ca5d8ce1f6f53c`, with zero resource and
  output changes.
- Sanitized deployment-receipt SHA-256:
  `bddea46a657ec922078ac7dbdf1d58280728ccb4d6e592670c48cbefa88746a2`.

Docker was not needed for this release. Docker remained stopped and WSL was shut down.

## Remaining D1-003 gates

- LR-D1-01 through LR-D1-03 provider/legal dispositions.
- Exact reviewed Greenhouse, Lever, or Ashby company configuration with no credentials committed.
- A separate activation record before enabling the runtime, schedule, mapping, or any source.
- Generated-synthetic deployed execution and dynamic source-pause/kill-switch acceptance through a
  guarded operator; this dark release intentionally invoked no ingestion handler.
- Real-provider network/data use remains prohibited until the applicable approval is recorded.
