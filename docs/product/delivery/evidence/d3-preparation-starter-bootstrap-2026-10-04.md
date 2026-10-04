# D3-070: Native preparation SQS starter

Date: 2026-10-04
Status: Source, focused checks and real PostgreSQL checks passed; full verifier/artifact pending.

The backend-only branch starts from fresh main bde17d9 and integrates exact open #539
212e6e28086093e0005fc197a0bd269ac886f0e2 locally. No GitHub merge occurs.

## Result and boundary

The default-off native starter qualifies its numeric invoked version, us-east-2 account,
managed database secret, standard SQS queue and distinct numeric durable target before I/O.
Private object/model/provider settings refuse. Warm configuration drift refuses recomposition.
Batch identifiers are validated and record fields detached before asynchronous setup. Invalid
queue/body/strict identifier input fails before secret access. Valid records use one lazy,
single-flight managed-secret setup; a failed setup is attempted once per batch and may retry
on a later invocation. SQL uses the Applications owner's native codecs and one connection.

The existing dispatch ledger and SDK adapter retain original execution name, payload and
qualified workflow version. A compact, unique retained-version list includes the current target
and permits only versions of that same durable function; older work is never retargeted.
Unretained original versions refuse Invoke. The native client requires one SDK attempt and
ignores configured endpoint overrides. Withdrawal refuses new dispatch; a positively acknowledged
original call may still record its receipt. Qualification is not IAM authentication, remote
cancellation or writer quiescence. Reviewed exact-version IAM/retention and release wiring remain.
No model, document writer, private activity, terminal settlement or recovery authority is composed.

## Local verification

- 48 focused cases pass: 36 native and 12 existing dispatch/SDK cases. They cover configuration
  refusal, input detachment, single-flight setup, failed setup once per batch, warm drift,
  withdrawal and individual effect failures without an in-handler effect retry.
- Seven connected PostgreSQL cases pass against an owned disposable PostgreSQL 16.14 fixture:
  normal dispatch/replay, accepted Invoke with lost acknowledgement, committed receipt with lost
  acknowledgement, retained original version, unretained version refusal, quarantined candidate,
  and refusal of an injected SDK client configured for automatic retry. Original consent remains
  unchanged; lost Invoke acknowledgement retries the same bytes/name/version after legitimate
  lease expiry and represents one simulated execution. No SQL expiry column is rewritten.
- Typecheck/build and the positive emitted bundle isolation guard pass. The maintained verifier
  includes that guard; it excludes emitted private/document/provider/terminal recovery actors.

Windows, Node 24.12.0, pnpm 10.24.0. SQL transactions and owner guards are real; secret responses,
Lambda context/receipts and lease clock are simulated. No live AWS/provider call or UI change.
The owned tmpfs fixture is removed, Docker Desktop stopped and WSL shut down; shared volumes
are retained. Logs remain ignored under .tmp/d3-070-*.log. No API/schema/migration/IAM changes.

## Remaining gates

Full exact-source verifier and local artifact checks are pending. Native terminal recovery,
release/IAM/scheduling, retained versions, original writer drain/retention and accountable/deployed
acceptance remain. Nothing is published, deployed or activated. D1/D3 remain In progress with
all phase exits unchanged. Hosted CI/CD is deferred until production launch by owner instruction.
