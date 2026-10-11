# D3 native packet recovery — 2026-10-11

D3-113 started 2026-10-11. A review-required packet whose temporary material is unavailable now has an explicit Prepare a new packet action. It uses the existing expected revision and stable idempotency key, prevents concurrent starts, and requires fresh review and approval. Lost-response retries preserve their original request; a revision conflict refreshes before a new request. Late generation reads cannot attach to a replacement packet.

Material verification now gives fixed, safe guidance for packet, availability, connection and content failures. No upstream error, response body, URL, credential or cause is retained in the error. Schema, exact packet/material binding, before/after availability checks, native-only content, deadline and approval safeguards remain unchanged.

95 targeted workspace, native UI and material-client tests, web typecheck and changed-file Biome checks pass. Review and hosted retry remain pending at this source checkpoint.

Managed worker/image publication, migration 0017, current-manifest completed-deletion replay and temporary replay-authority cleanup pass. The separate SPA sign-in, search, fresh preparation, native r2 launch and generated-material attachment pass in the disposable synthetic account. Native preview verification fails; approval is correctly blocked. This is not accepted native end-to-end behavior. AI remains off because the required all-copy retention policy is unavailable; employer submission remains off because authorized QA/fixtures and grants are unavailable. Independent D1/admin acceptance stays deferred.

Development test runtimes are active for this batch and must be shut down before handoff. Docker/WSL are off; the PC stays on. Final shutdown and hosted retry results will supersede this checkpoint.
