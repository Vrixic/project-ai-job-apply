# D1 Lever and Ashby Dark Adapter Candidates

- State: Implemented and generated-synthetic verified; default off
- Provider counsel gates: LR-D1-02 and LR-D1-03 removed by ADR-025; exact source activation pending
- Runtime/source/schedule flags: `false`
- Real site/board configuration, employer data, and network execution: absent
- Adapter versions: `lever-postings-v1` and `ashby-job-board-v1`

These source-only candidates close the remaining provider-adapter implementation gap in D1-003
without granting activation authority. Both use fixed-host public `GET` endpoints documented by the
providers: Lever's published Postings API and Ashby's public Job Postings API. They accept only
explicit reviewed company/domain configuration, refuse credentials, redirects, caller-selected
URLs, alternate ports, oversized responses, and batches over 100 jobs, and return only fixed retry
reasons for rate limiting, timeout, or source unavailability.

The Lever candidate supports the provider's paired global and EU API/hosted-job domains. It binds
every returned hosted URL to the configured site and posting ID, strips query tracking, consumes the
provider's plaintext description, and performs one bounded overflow probe when the first 100-item
page is full. It never calls Lever's application `POST` endpoint. Work mode is mapped only from the
documented exact `remote`, `hybrid`, and `on-site` values; employment type is not inferred from
free-form commitment text.

The Ashby candidate calls only
`GET /posting-api/job-board/{JOB_BOARD_NAME}?includeCompensation=false`, requires API version `1`,
omits every `isListed: false` posting, and binds each hosted job URL to the configured board plus
opaque posting ID. Work mode and supported employment types are mapped only from Ashby's documented
enums. `Temporary` is deliberately left unclassified because the canonical D1 contract has no
truthful temporary category. Compensation is not requested or stored.

The immutable registry rejects each enabled provider/`permitted_api` descriptor by default and
admits it only when the runtime supplies explicit provider authority. Activation requires exact
company configuration, private NAT egress, immutable artifact publication, deployed bounded
provider acceptance, pause-gate proof, and an attributable ADR-025 source activation record. This
document grants none of those authorities.

Provider contract references:

- [Lever Postings API](https://github.com/lever/postings-api)
- [Ashby public Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api)
