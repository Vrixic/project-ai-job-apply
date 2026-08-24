# D1 Greenhouse Dark Adapter Candidate

- State: Implemented and generated-synthetic verified; default off
- Provider counsel gate: LR-D1-01 removed by ADR-025; exact source activation still pending
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

The immutable registry rejects an enabled Greenhouse/permitted-API descriptor by default and admits
it only when the runtime supplies explicit provider authority. Activation requires exact
board/company configuration, private NAT egress, immutable artifact publication, deployed bounded
provider acceptance, pause-gate verification, and an attributable ADR-025 source activation record.
This document grants none of those authorities.
