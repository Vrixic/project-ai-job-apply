# D3-074: Approval recheck before submission dispatch

Date: 2026-10-04. Backend-only source and local generated-synthetic verification.
D1/D3 remain In progress. Hosted CI/CD remains deferred until production launch.

## Source and observed gap

Started from freshly fetched main `bde17d9ed94448fb04393f295122176a875a8d2b`, then
fast-forwarded exact open #543 `3ee4d2c196770b74a113b358824e8cb5238add53`.
Branch: `fix/d3-pre-dispatch-approval-recheck`.

The existing store checked approval at attempt start, then issued a later write-ahead dispatch
receipt without rechecking approval expiry or current bindings. Five real PostgreSQL reproductions
all failed against the original source: expired approval and changed job/form/resume/cover-letter
bindings still returned `dispatched`. `.tmp/d3-074-reproduction.log` preserves that synthetic proof.

## Implemented path

Authenticated Gateway route → owner application/attempt read → live owner bindings → Applications
transaction/row locks → original packet/approval identity and current admission time → fresh
approval evaluation → dispatch receipt or committed no-effect refusal.

- The service checks that the attempt belongs to the authenticated owner's application before
  private binding reads. Unavailable reads do not become assumed-current values.
- The store requires and detaches current bindings before awaiting locks. It checks exact original
  packet/approval/attempt identities and evaluates expiry after its SQL reads. There is no fallback
  to the original packet for an older internal caller that supplies no snapshot.
- Stale approval settles the still-undispatched attempt as `failed_no_effect`, invalidates the
  exact live approval and moves directly to `review_required`. Two value-free history entries,
  one application revision and one final status outbox event commit atomically. No intermediate
  `approved` event, dispatch timestamp or dispatch receipt is emitted. The error is thrown after
  commit, so failure reporting cannot roll back the refusal.
- Internal `dispatch_refused` maps to the existing review-required status and approval-invalidated
  history kind. The database's allowed status pairs are unchanged. Ordinary edit-again remains
  forbidden while an attempt is started or dispatched. Manual takeover never dispatches.
- Expiry alone uses the existing 409 `application_packet_stale` code with fixed review-and-approve
  text; material changes retain existing new-packet guidance. Neither response echoes diagnostics.

[Store](../../../../backend/services/applications/src/store.ts),
[service](../../../../backend/services/applications/src/service.ts),
[state machine](../../../../backend/services/applications/src/state-machine.ts),
[HTTP projection](../../../../backend/gateway/src/applications-http.ts).

## Verification

- Applications: 120 unit cases, including six new service/store admission cases; build,
  typecheck and scoped Biome pass. `.tmp/d3-074-applications-unit-final.log`.
- All 67 real PostgreSQL Applications cases pass (twelve new). Tests include the five stale
  conditions, eight concurrent deliveries, detached caller mutation while waiting for a lock,
  expiry while queued, a real PostgreSQL outbox failure with full rollback and retry, unchanged
  edit-again restrictions for started/dispatched attempts, and one fresh reviewed packet after
  refusal. Existing happy/manual/duplicate/ambiguous/privacy/hardening cases remain passing.
  `.tmp/d3-074-applications-postgres-final.log`.
- Five Gateway PostgreSQL cases pass (three new): the actual composed dedicated owner runtime
  refuses changed/inactive jobs and expired queued approval. The canonical catalog/Profile
  ports are synthetic; SQL, dedicated database codec and composed service/store are real.
  `.tmp/d3-074-gateway-postgres.log`.
- Three fixed problem-projection cases and one authenticated Nest/Fastify dispatch HTTP case pass.
  The HTTP case verifies 409, `no-store` and suppression of private exception text. Test RS256
  authentication and a fake Applications port are used; this is not live managed OIDC.
  `.tmp/d3-074-dispatch-http.log`. Gateway typecheck passes.
- PostgreSQL 16.14-alpine; exact owned tmpfs fixture `ai-job-apply-d3-074-pg`, loopback port 55442,
  database `application_dispatch_d3_074`. Existing migration runners apply the schema; the
  Applications runner is independently replayed. Fault injection only installs a generated,
  exact-application trigger in a guarded loopback disposable database; it replaces no guard and
  removes its own trigger/function. No fixture data is production candidate data.
- Full maintained verifier passes on clean source `adf46c8aec1d401407976dce666a236cb3277561`,
  terminal exit 0 and `Phase 0 repository verification passed.`: 38 typecheck tasks, 39 test
  tasks and 23 builds. Applications 120 units; Gateway 298 units with 15 explicit opt-in skips;
  Workflows 1,588 units with 57 explicit opt-in skips. Contract, formatting, security/operational,
  restore-boundary, Compose and emitted-isolation checks pass. Lint retains the existing
  0 errors, 15 warnings and 58 informational notes. These unit tasks do not replace the real
  SQL runs above. `.tmp/d3-074-full-verification-adf46c8a.log`.
- Exact owned temporary fixture removed; Docker Desktop stopped and WSL shutdown completed,
  terminal exit 0. Shared volumes retained. Only delivery documentation follows verified source.

[Applications SQL regressions](../../../../backend/services/applications/src/store.integration.test.ts),
[Gateway SQL composition](../../../../backend/gateway/src/applications-database.integration.test.ts),
[service unit cases](../../../../backend/services/applications/src/submission-dispatch.test.ts),
[authenticated HTTP case](../../../../backend/gateway/src/app.test.ts).

## Compatibility and remaining acceptance

No public request/response schema, generated type, domain/event schema, migration, Terraform,
operational guard, frontend, activation flag or publisher changes. New internal callers must
provide fresh bindings; existing public dispatch inputs and status/error shapes remain valid.
Compatible Gateway code review/release and deployed acceptance remain. No provider/cloud/model
effect, automated submission, publication, deployment or activation is performed.

Owner bindings are point-in-time reads before the Applications transaction, not an atomic
cross-owner lease. The dispatch endpoint has no new observed form input and keeps original form
context; a future enabled adapter must separately revalidate the live destination structure before
any effect. This source check does not certify remote writer quiescence or add Vault version
binding. Exact saved-answer context/review/revision invalidation remains D3-001/D3-005 work.

No browser acceptance is claimed: the deployed manual path does not call automated dispatch, and
no enabled fixture-backed extension submission executor exists for this path. D3-007/D3-013,
independent D3-012 decisions, deployed replay/quality/security/accessibility and D3-019 journeys
remain open. Local SQL/HTTP evidence does not close any phase exit criterion.
