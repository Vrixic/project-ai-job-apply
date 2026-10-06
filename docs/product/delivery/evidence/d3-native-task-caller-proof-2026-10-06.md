# D3 original native task caller authentication — 2026-10-06

Status: source/local verification; D1/D3 remain In progress. No cloud deployment or activation.

The native runtime still needs authenticated owner/control adapters. Existing exact-target and
SQL registry checks identify an allocation but do not authenticate which remote task sent a
request. A shared role without per-task caller verification cannot establish that binding.

The private version-one caller proof now binds original allocation/owner/application/generation/
epoch/work metadata, exact numeric Lambda recipient and exact request digest in an SDK-signed
STS context header. Its seven signed headers, fixed body/hash/host and UTC timestamp are strict;
local acceptance is limited to 60 seconds, with two seconds of future clock tolerance. Local
validation proves shape/context/freshness only. The private verifier must submit that fixed
GetCallerIdentity request to AWS and require the configured account/role and original ECS task
session in its authenticated reply. It rechecks proof freshness and flags after the response.

AWS documents task-role credentials and task identity in role sessions in
[ECS role guidance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-iam-roles.html).
The verifier uses [STS GetCallerIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html).
Actual managed-task conformance and reviewed role trust are still required. The task role must
allow only ECS to assume it; arbitrary non-ECS sessions named as a task must be prohibited.
This is authentication, not physical liveness, consent, owning admission, work settlement,
termination or candidate-rights purge. Owning checks must still follow it and surround awaits.

## Data and capability boundaries

- The producer uses explicit credentials from the exact ECS link-local credential endpoint and
  fixed UUID relative path. Shared profiles, environment access keys, web identity, AssumeRole,
  instance credentials, full URIs and authorization-token files are not fallback sources.
  Metadata responses are bounded, exact-shaped, same-account, temporary and nonexpired.
- The actual SDK signs one fixed GetCallerIdentity action; a local HTTP handler captures the
  signed request without sending it. The receiver alone submits it to the fixed regional HTTPS
  endpoint. No caller-selected URL, body/action, redirect, role assumption or proof cache exists.
  SDK telemetry is removed before signing; no arbitrary unsigned fields are accepted.
- Proof headers contain ephemeral credential material. Never put them in logs, SQL, queues,
  events, artifacts, workflow state, analytics, receipts or exports. Metadata/response byte
  buffers and the receiver's owned headers are cleared after real transport settlement.
  This does not claim physical zeroization of JavaScript strings or external AWS copies.
- The receiver parses bounded XML with strict namespace/structure, no DTD/processing instruction/
  CDATA, duplicate/unknown fields or permissive identity matching. Errors reveal no credential,
  source payload or remote diagnostics. Pending-call admission lasts until the original fetch/read
  settles; timeout cannot cause late authentication success.
- Test credentials and verifier injection refuse outside `NODE_ENV=test`. Production uses the
  ECS credential provider and actual fixed-origin fetch. Both sides default off.

## Local verification

57 new tests pass with actual SDK signing and synthetic task metadata/STS replies; 91 existing
launch/scalar-control regressions pass (148 combined). Cases cover workstation credential
isolation, unsafe metadata origins/paths and expiry, retargeted original/request/version,
foreign role/task/user identity, changed signatures refused by the simulated AWS verifier,
expired/pending proof, strict XML/response bounds, value-free errors and production refusal of
test ports. Logs: `.tmp/d3-native-caller-focused-final-3.log`,
`.tmp/d3-native-caller-typecheck-final-3.log`, `.tmp/d3-native-caller-build.log`.

The initial metadata fixture used credentials expiring in one minute and caused the SDK's
expected imminent-expiry refresh. Giving the positive fixture the documented six-hour task
credential lifetime fixes the one-fetch assertion; no production refresh or lifetime guard is
weakened. This credential lifetime does not renew generated material or original consent.

Two emitted-bundle isolation/default-off cases pass. Producer includes only pure native metadata,
the ECS credential helper and STS signing; receiver includes only pure metadata/strict XML/fetch.
Neither includes domain-owner runtimes, SQL, object storage, Lambda/task/secret/KMS control,
generation or rendering. Log: `.tmp/d3-native-caller-bundle.log`. This check is added to the
maintained full verifier. Dependency pins and public API/domain/event schemas are unchanged.

Full verification passes for clean committed source
`bffe650bd23e3304ff38f488b877c4dc8deaf3a9`: 38 typecheck tasks, 39 test tasks and
23 production builds, plus maintained operator/security/isolation, Compose and scope checks.
The original verifier session exited zero; the tracked tree stayed unchanged during verification.
Lint remains zero errors, 15 warnings and 58 informational notes.
Log: `.tmp/d3-native-caller-full.log`. Cached unaffected tasks are included in these totals;
this is local source evidence, not deployment or a new cold image build.

No actual ECS credentials, AWS identity call,
managed role trust, authenticated evidence/control RPC composition, native image/bootstrap,
TLS/routing, client/ATS/provider/accountable acceptance or phase completion is claimed.
No Terraform/IAM or frontend change, publication/deployment/activation, third PR or hosted CI/CD.
Docker/WSL stay stopped, shared volumes remain, and the PC stays on.
