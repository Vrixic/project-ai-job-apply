# D3 native preparation flow — 2026-10-06

Status: source and local owner SQL evidence; default off. D1/D3 remain In progress.

`createNativeCoverLetterPreparationPort` connects the Applications write-ahead claim to current
owner evidence, a canonical memory-only request digest, one Documents reservation and one direct
provider-dispatch grant, then the existing private numeric native launcher. No legacy S3 slots,
provider objects or generated bodies cross this activity. A sealed prior admission epoch is read
from its Documents owner; the launcher independently admits that exact predecessor.

Only a fresh reservation/grant winner launches. Missing or ambiguous acknowledgements stay
in progress; replay neither renews work nor launches another generation. A crash between these
boundaries leaves incomplete original work for existing terminal compensation, not launch authority.
There is no new task-discovery or absence inference. A positive launch response is not readiness.

Recovery reads only the original Documents scalar ready receipt. Its SQL joins exact owner,
application, document, context hashes, consent expiry, settled successful work and bound claimed
allocation to the current unsealed admission epoch. Original completion and expiry remain fixed.
The adapter validates the receipt and returns the original temporary material reference, content
hash, actual cited fact IDs and confidence to the existing Applications completion activity.
Receipt availability is point-in-time metadata, not a listener/liveness or process-death proof;
native content authorization must still independently check admission at read time.

Local verification:

- 33 focused workflow cases pass (11 native preparation cases and 22 existing isolated cases).
- Documents build and Workflows typecheck pass. The first typecheck exposed the missing explicit
  API-contract dependency; the workspace dependency and lockfile now match.
- All 24 real PostgreSQL launcher/owner integration cases pass. The expanded case recovers a
  version-2 receipt through the actual Applications activity, commits a succeeded preparation and
  replays it without a launch port. Wrong document/application/context/consent expiry and sealed
  admission reads refuse; a sealed predecessor can be read without issuing work.
- SQL used a newly owned loopback PostgreSQL 16.6 tmpfs fixture and the actual four owning
  migrations, applied twice. AWS/Lambda/ECS authentication/transport and secret resolution are
  simulated; no live provider or task evidence is asserted.
- Owned fixture removed after checking its exact ownership label; shared volumes untouched.
  Docker/WSL stopped; PC remains on.

Managed runtime selection/bootstrap, sender IAM, native routing/content client/ATS transport,
real provider and accountable approval remain separate gates. The existing deployed preparation
runtime is not switched by this source factory. No deployment, activation, frontend change, new
PR, production acceptance or phase completion is claimed. Hosted CI/CD remains deferred.

## Full verification

Clean committed source `e8b4775bde57060cf5f0e455594fd3d5cd287aa8` passes
`scripts/verify-phase0.ps1`: 38 typecheck tasks, 39 test tasks, 23 production builds, formatting,
operator/security/isolation/Compose and emitted native artifact checks. Lint remains zero errors,
15 warnings and 58 infos. Log: `.tmp/d3-native-preparation-full-final.log`.

The first run genuinely failed when the owned Next.js development parent restarted its stopped
child and reclaimed the session fixture's exclusive port 3000. Stopping the verified owning
parent resolves it: all 101 session cases and the unchanged-source full rerun pass. No session
guard, timeout or authentication constraint is weakened. The development web is restored after
terminal verification; only Next.js's two generated development type imports are restored.
