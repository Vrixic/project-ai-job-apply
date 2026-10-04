# D3-063 original background terminal drain — local source evidence

Date: 2026-10-04. Backend-only branch `feat/d3-original-background-terminal-drain`,
base main `bde17d9ed94448fb04393f295122176a875a8d2b`. No deployment or activation.

## Behavior and boundaries

The additive AI SDK opt-in returns closed metadata-only original failed/cancelled/incomplete
receipts after acknowledged creation capture. Completed output and existing API return types
and failures remain compatible. Queued/running, changed response metadata, HTTP errors, thrown
receipts, lost capture ACKs, timeout and late completion cannot qualify.

The captured actor requires matching original response, model and prompt provenance before
calling the separate closed private v1 `settle_terminal` action. It performs no result write.
The one-attempt numeric-version RPC verifies exact work/reference/status echo; older composed
handlers refuse without ordinary/rejected settlement fallback. Native default-off bootstrap
binds the owning SQL method, with the existing lazy managed-secret and max-one pool.

One transaction locks the owning document, original work and matching inventory, validates
acknowledged identity (or matching disposed terminal status), permanently fences unclaimed
phases and settles only the original provider grant. No lock spans external I/O. Replays
preserve terminal timestamps. Running other writers remain running; response inventory is
unchanged. No renewal, dispatch, disposal, object deletion or quiescence authority is supplied.

## Executed local verification

- AI SDK units: 283 passed, including 79 original background cases (33 new).
- Documents units: 1,014 passed (35 new actor/control/bootstrap cases).
- Real PostgreSQL 16.6: all seven Documents integration files, 275 cases passed (13 new).
  These connect the actual gateway/provider HTTP serializer, original capture, private RPC,
  native one-connection bootstrap and owning store. Provider HTTP, Lambda Invoke, managed
  secret resolution and authentication are simulated; no live OpenAI, AWS Lambda, S3 or OIDC
  end-to-end claim. Cases cover all three statuses, quarantine, unknown capture, changed
  id/time/hash, matching/conflicting disposal status, lost committed settlement ACK, old
  composition and another running private writer. Replay performs no second model POST.
- Initial PostgreSQL run identified two fixture assertion/setup errors; final full run above
  fixes mismatched consent and expects quarantine admission refusal. No product guard loosened.
- Full `scripts/verify-phase0.ps1` passed: 38 typecheck tasks, 39 test tasks, 23 builds,
  unchanged generated public contracts, formatting, baseline lint (0 errors, 15 warnings,
  58 informational notes), operational/security regressions, Compose and product scope.

Logs are local ignored files `.tmp/d3-063-ai-unit.log`, `.tmp/d3-063-documents-unit.log`,
`.tmp/d3-063-documents-integration-final.log` and `.tmp/d3-063-full-verification.log`.
The exact temporary tmpfs container was removed; Docker Desktop and WSL stopped.

## Compatibility and remaining gates

Private v1 addition only: deploy a compatible control handler before any reviewed actor pinned
to its numeric version. Missing support leaves work unresolved. No public API/generated types,
SQL migration/backfill, frontend or Terraform changes. Existing default-off gates remain.

Hosted CI/CD is deferred by owner until production launch. Local source verification does not
waive production security/privacy, dependency, deployment or independent acceptance gates.
Original writer drain, maintenance/disposal reconciliation, IAM/runtime composition,
provider retention guarantees and deployed acceptance remain unfinished. Terminal observation
does not certify provider-wide deletion. D1/D3 exit criteria remain open.

Implementation and executable evidence: [gateway](../../../../packages/ai-sdk/src/gateway.ts),
[original transport tests](../../../../packages/ai-sdk/src/openai-background.test.ts),
[actor](../../../../backend/services/documents/src/cover-letter-provider-handler.ts),
[private contract](../../../../backend/services/documents/src/cover-letter-provider-control-contract.ts),
[owning transaction](../../../../backend/services/documents/src/cover-letter-work-store.ts),
and [SQL cases](../../../../backend/services/documents/src/cover-letter-response-store.integration.test.ts).
