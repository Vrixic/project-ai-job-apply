# D3 original resume task address lookup - 2026-10-07

D3-064/D3-079 remain In progress. This is a local, default-off private address reader,
not a routed or deployed download endpoint. ADR-040 remains Proposed.

## Implemented

The Documents-owned [reader](../../../../backend/services/documents/src/native-resume-task-address.ts)
accepts only the original five-scalar generation scope. Its owning registry selects the bound
task and original launch configuration. A ready, unexpired original material reference is required.
Signed ECS DescribeTasks checks the exact task/definition/image, original six overrides, running
task/container and attached network interface. EC2 DescribeNetworkInterfaces receives only that
exact interface ID and checks account, subnet, private address, security groups and public IPv4.
A second ECS observation and owning ledger read must still match before returning scalar metadata.
The original launch override construction is shared with the launcher without changing its bytes.

Both AWS clients use fixed us-east-2 service endpoints, one SDK attempt, a common bounded deadline
and silent SDK loggers. No cloud clients are constructed while disabled. A timed-out request
retains local admission until its actual transport settles. Errors do not expose upstream details.
The new EC2 SDK dependency is pinned to 3.1133.0, matching the existing direct ECS SDK version.

This is network observation only. The recovery-oriented ledger port is not current candidate
admission and can read sealed allocations. The future DNS writer must separately check owning
admission, preserve original routes through ambiguous acknowledgements, and reconcile retirement
cleanup. A result cannot prove continued task life, public ingress, valid TLS or content access.

AWS documents the one-ENI Fargate task model and optional public address in
[Fargate networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html);
the address lookup uses [DescribeNetworkInterfaces](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeNetworkInterfaces.html).

## Local evidence

- Documents TypeScript build and focused Biome checks pass.
- 51 new address-reader cases plus existing observer/launch suites pass: 113 cases total.
  AWS and the owning ledger are simulated; no fresh real SQL or live managed call is claimed.
  The first run rejected the fixture's invalid shortened material lifetime. The fixture now uses
  the existing exact 1,800,000 ms lifetime, including a valid expired reference.
- The actual compiled/bundled reader passes default-off refusal with zero owner effects and an
  inspected dependency graph excluding SQL, document objects, renderers and DNS mutation SDKs.
- All 142 dependency remediation regression cases pass. The fresh registry audit **fails**:
  node-forge 1.4.0, braces 3.0.3, source-map-js 1.2.1, sharp 0.35.4 and shell-quote 1.10.0 have
  reported advisories, including critical shell-quote. All five versions already occur in
  pre-change HEAD's lockfile. The registry also reports two image-size advisories covered by the
  maintained local patch tests. No risk waiver or complete passing dependency audit is claimed.
  Coordinate the five outstanding dependency findings with the frontend work before launch;
  this backend-only batch does not change those dependency paths.

Logs: `.tmp/d3-resume-address-{tests,build,dependency,audit}.log`; raw registry results:
`.tmp/d3-resume-address-audit-raw.json`. Compiled smoke: `.tmp/d3-resume-address-smoke.mjs`.

## Remaining work

Select the download base hostname/DNS zone (owner question remains pending), connect DNS
registration/propagation and cleanup to original task lifecycle, supply certificate/ingress and
reviewed IAM/network composition, then exercise the enabled managed download flow. The AWS SSO
session was last observed expired; there is no fresh managed verification in this batch. Existing
user-confirmed D1 browser checks stand. No publication/deployment, CI/CD or frontend changes.
Docker/WSL were not started; the PC remains on. D1 and D3 are not complete.
