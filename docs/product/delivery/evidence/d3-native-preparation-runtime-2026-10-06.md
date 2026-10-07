# D3 dedicated native preparation runtime — 2026-10-06

Status: default-off source and local owner SQL evidence; D1/D3 remain In progress.

`native-application-preparation-lambda.ts` supplies a dedicated private activity using the existing
preparation input/result contract. Exact same-account, regional numeric activity and launcher
targets, managed database secret and packet-protection key ring are validated before lazy
initialization. Its configuration is pinned across warm invocations. Sender IAM remains required;
numeric target matching is not caller authentication. No existing deployed activity is switched.

The native composition has separate one-connection native Documents/work/candidate-lease pools
and separate Applications/Profile/Jobs pools. Documents exposes only original reservation,
provider-dispatch issue, scalar receipt read and prior sealed-epoch read. Object read/write ports
refuse. Current candidate evidence stays within the activity, and the private launcher receives
only original IDs and request hash. Recovery cannot reserve, issue, invoke a provider or launch.

`NATIVE_APPLICATION_PREPARATION_ENABLED` stays default off.
`NATIVE_APPLICATION_PREPARATION_LAUNCH_ENABLED` separately admits fresh generation; false or
absent prevents new reservation/work while original receipt recovery remains available. Strict
legacy provider/object settings refuse, so this artifact cannot silently select the old path.

The first fresh-flow SQL fixture incorrectly used the ingestion record instead of the hydrated
job view; the corrected fixture then exposed a real missing packet-protection composition.
Applications now requires its existing protection for preparation reads/writes. The new runtime
binds `RESTRICTED_PACKET_PROTECTION_ENABLED`, exact distinct same-account us-east-2 encryption
and fingerprint key ARNs, and canonical optional historical key-ring JSON. Drift or withdrawal
refuses through the pinned runtime and existing protection guards. No protection guard is weakened.
Synthetic cipher injection is limited to NODE_ENV=test; production uses the existing KMS cipher.

Local checks:

- All 77 focused native preparation/bootstrap and existing activity-bootstrap cases pass.
- Workflows typecheck passes.
- All 25 actual PostgreSQL launcher/owner cases pass. The added fresh-flow case uses the actual
  dedicated runtime and owning pools, one canonical reservation/grant, private launcher admission,
  worker claim/settlement and original completion/ready stores. After a simulated lost original
  launch ACK, a new delivery completes the actual Applications packet and terminal replay does
  nothing. Inventory is one document, one dispatch grant, zero private slots and one RunTask.
- PostgreSQL 16.6 uses a newly owned loopback tmpfs fixture and four actual owning migrations
  applied twice. AWS/Lambda/ECS/provider outcomes and the existing synthetic KMS transport are
  simulated; no real task/provider/KMS acceptance is claimed.
- Dedicated emitted artifact checks exclude S3, ECS, OpenAI, native content/rendering and the
  legacy preparation adapter, and verify default-off refusal. The maintained verifier includes
  this artifact isolation check.

`build:lambda:native-preparation` creates a separately named artifact/output root using the
existing clean-source builder, source manifest, SBOM and bundled default-off checks. Full clean
verification and exact artifact evidence are pending at this implementation checkpoint.

Managed artifact publication, durable activity target selection, IAM, native routing/client/ATS,
real provider, real key/role and accountable approval remain. No cloud deployment/activation,
frontend change, new PR, CI/CD work or phase completion is asserted. The owner PC stays on.
