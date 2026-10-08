# D3 original resume DNS transport - 2026-10-07

D3-064/D3-079 remain In progress. This default-off private adapter implements the Route 53
transport needed after [original task address discovery](d3-native-resume-task-address-2026-10-07.md).
It is not connected to preparation/retirement and does not complete the download flow.

## Implemented boundary

[The adapter](../../../../backend/services/documents/src/native-resume-dns-route.ts) captures a
validated immutable allocation ID, public IPv4, hosted-zone ID and base hostname. It constructs
one simple A record at `allocation.baseHost`, TTL 30 seconds, and an original-intent digest.
Only `CREATE` and an exact-original `DELETE` are exposed. There is no `UPSERT`, arbitrary record
name, alternate record type, endpoint override or automatic retry.

Exact inspection requests one record starting at the original name. A different next name is
projected to absence; a conflicting original name/address/TTL/alias/weighted record refuses.
`GetChange` must return the requested original change ID and `PENDING` or `INSYNC`. Inspection
and propagation status are separate: a present record is not proof of propagation, and absence
is not proof that an earlier unknown request cannot still commit. `INSYNC` does not prove client
cache expiry, valid TLS, task liveness, candidate authorization or material retirement.

The production client uses the fixed global Route 53 endpoint with us-east-1 signing, one SDK
attempt and a bounded abort signal. Local admission stays held until an abort-ignoring transport
settles. Withdrawing new creation preserves inspection/deletion when the independent runtime
gate remains enabled. All operations default off; upstream diagnostics are reduced to a fixed
error. The SDK is pinned to 3.1133.0. Existing token-provider transitive pins were retained after
the package installer attempted an unrelated refresh; frozen installation succeeds.

The public IPv4 policy is shared with task discovery through a pure scalar module, without
bringing ECS/EC2 clients into the DNS adapter or the DNS client into task discovery.

API semantics were checked against AWS's
[change API](https://docs.aws.amazon.com/Route53/latest/APIReference/API_ChangeResourceRecordSets.html),
[record listing](https://docs.aws.amazon.com/Route53/latest/APIReference/API_ListResourceRecordSets.html)
and [global endpoint reference](https://docs.aws.amazon.com/general/latest/gr/r53.html).

## Local verification

- Documents TypeScript production build and focused Biome checks pass. The initial compilation
  found an SDK/test-client union-call typing mismatch; the explicit narrow transport interface
  fixes it without changing runtime behavior.
- 27 DNS cases and 51 task-address cases pass (78 total). They exercise create/inspect/pending/
  propagated/delete, original binding, independent gates, conflicting records, malformed replies,
  unknown acknowledgements, timeouts and withdrawal with simulated Route 53/ECS/EC2/ledger ports.
- The actual compiled/bundled DNS adapter refuses all four default-off operations; its emitted
  dependency graph excludes SQL, ECS/EC2, document objects, renderers and private owner RPCs.
  The previous compiled task-address isolation check also passes after the shared-policy move.
- `pnpm install --frozen-lockfile` passes. The previous batch's five outstanding dependency
  advisory findings remain unresolved; no new passing registry-audit claim is made.

Logs: `.tmp/d3-resume-dns-{build,tests,install,smoke}.log`. No live AWS request or DNS mutation,
real database run, complete repository verifier, cloud publication or deployment was performed.

## Required next composition

The owning workflow must persist the immutable route intent and a one-attempt write claim before
DNS mutation, capture accepted change IDs, and recover unknown acknowledgements without blindly
recreating a deleted route. Current owner admission must gate creation. Retirement must retain
the original intent until all possible creators are drained and exact deletion has propagated;
neither a timeout nor a missing record can close this obligation. Connect these states to packet
readiness and the original task observer, with bounded reconciliation for missed events.

The configured base hostname/zone is still an unanswered owner choice. Certificate, public ingress,
reviewed IAM/network reachability, release and managed browser-download acceptance remain open.
ADR-040 remains Proposed; D1/D3 are incomplete. No frontend or CI/CD changes. Docker/WSL were not
started and the PC remains on.
