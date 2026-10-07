# D3 authenticated native resume source — 2026-10-07

D3-064/D3-079 source and local verification only. D1/D3 remain In progress;
ADR-040 remains Proposed. Nothing is deployed or activated.

## Implemented path

Original native resume task → separate SDK-signed numeric Lambda source recipient →
original task authentication → Documents ledger and candidate source lease → owned
parsed-resume metadata and Jobs context → version/digest-checked normalized S3 source →
final original admission → bounded retained-source reply. Generated material never
enters this source RPC; generation and rendering remain in the native process.

The request binds the exact original bootstrap identity, normalized digest and canonical
job to the existing task/configuration/epoch binding. A distinct source request digest
rejects scalar-control proofs. The client exposes only the session-compatible `load`
port; it receives no source locations, object credentials, SQL, model, launch or
completion capability. The scalar owner RPC remains unchanged and excludes source reads.

Documents checks the original uncompleted bound generation, exact base/version/hash,
normalized digest, task/configuration and original preparation/job before source access
and after awaits. Jobs returns the exact full title/description only after its existing
canonical/source/revision/context proof. Ordinary admission/Jobs transactions finish
before object I/O; a separate candidate lease holds active identity across retained-source
access. A source hold, changed job/packet, completion or seal withholds the result. This
is point-in-time admission, not proof that future reads remain authorized.

The existing normalized-object reader and parsed-resume lookup are extracted into narrow
modules with compatible old exports. The S3 reader still verifies exact key/version,
KMS metadata, bounded bytes and the original serialized normalized SHA before parsing.
The source reply validates closed document/block/job shapes and matching base/job identity.
Canonical RPC serialization is not asserted to reproduce the original S3 byte digest.
Transport buffers are cleared after settlement; JavaScript retained-source strings are
not claimed to be physically erased. No new source persistence or generated-body storage.

The private Lambda initializes owners only after task authentication. Independent
`NATIVE_RESUME_SOURCE_RPC_ENABLED`, `NATIVE_RESUME_SOURCE_RPC_DEPLOYMENT_JSON`,
`NATIVE_RESUME_SOURCE_BUCKET` and `NATIVE_RESUME_SOURCE_KMS_KEY_ARN` pin its configuration;
managed database secret, region/account and numeric runtime identity remain required.
Ambient database/model credentials and warm configuration changes are refused. S3 is
fixed to the regional endpoint, one attempt and bounded connection/request timeouts.
Publication, reviewed source-only IAM and managed role/task conformance remain gates.

## Local verification

- Documents, Jobs and Workflows compile. All 66 focused source, existing owner RPC,
  processor and tailoring cases pass; 22 are source cases. Actual SDK signing and the
  actual normalized S3 reader are exercised with synthetic credentials/object responses.
- All 32 PostgreSQL 16.6 ledger cases pass. Six new cases connect the lazy authenticated
  source Lambda to actual Documents/Jobs ownership, prove completed-generation refusal,
  source hold/job/seal races during object I/O, configuration refusal and candidate
  quarantine exclusion/release. Four owners' migrations replay twice. AWS identity,
  Lambda delivery, managed-secret resolution and object reader are synthetic in SQL tests.
- All 15 emitted owner RPC/native runtime bundle checks pass, including three new source
  boundaries. Task client and receiver exclude SQL/S3/owners as appropriate; the source
  Lambda contains actual owners/S3/normalization but excludes parsing runtime, rendering,
  model and task launch/retirement. Existing scalar owner exclusions still pass.
- Formatting passes. Lint retains zero errors, 15 warnings and 58 informational findings.
- Exact-source artifact build and full frozen-source verification follow.

No public API, event, SQL migration, frontend or infrastructure change. The current
71-migration/93-relation restore inventory remains unchanged. Owned tmpfs fixture removed;
shared volumes retained, Docker/WSL stopped, PC on. Hosted CI/CD remains owner-deferred.
No new PR, main merge, cloud publication or deployment.

Resume task/image/bootstrap/launch, preparation/current-packet/read integration,
client/ATS and managed/accountable acceptance remain. No new Linux rendering/image
or authenticated live-browser acceptance is claimed by this source batch.
