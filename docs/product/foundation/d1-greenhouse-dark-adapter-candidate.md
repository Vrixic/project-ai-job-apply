# D1 Greenhouse Dark Adapter Candidate

- State: Implemented and generated-synthetic verified; activation prohibited
- Provider gate: LR-D1-01 remains `Not started`
- Runtime/source/schedule flags: `false`
- Real board token, employer data, and network execution: absent
- Adapter version: `greenhouse-job-board-v1`

This is the first provider-specific implementation candidate for D1-003. It uses only Greenhouse's
public Job Board `GET /v1/boards/{board_token}/jobs?content=true` endpoint on the exact
`boards-api.greenhouse.io` host. Redirects, credentials, caller-selected URLs, alternate ports, and
responses over one megabyte are refused. Acquisition has a five-second default deadline and a
100-job maximum. Returned application URLs must use an approved Greenhouse job-board host and
match the configured board token plus returned numeric job identifier exactly; query tracking is
removed. HTML content is converted to bounded plain text before entering the Jobs contract.
Provider records cannot set provenance, provider, observation time, or adapter version.

Company name and verified company domain are explicit reviewed configuration, not inferred from a
board token or provider payload. Work mode, employment type, expiry, and original posting date are
not inferred because the selected response does not establish those semantics. Empty batches do
not close jobs. HTTP 429, unavailable responses, and timeouts become fixed retry reasons without
retaining URLs or payload values.

The immutable registry accepts the exact Greenhouse/permitted-API descriptor only when disabled.
Any `enabled: true` registration fails construction. Activation requires a separate source-specific
change after LR-D1-01, exact board/company configuration review, egress review, immutable artifact
publication, deployed synthetic/provider-contract acceptance, pause-gate verification, and a new
reviewed release flag. This document grants none of those authorities.
