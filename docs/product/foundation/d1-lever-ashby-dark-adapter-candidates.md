# D1 Lever and Ashby Dark Adapter Candidates

- State: Implemented and generated-synthetic verified; activation prohibited
- Provider gates: LR-D1-02 and LR-D1-03 remain `Not started`
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

The immutable registry admits each exact provider/`permitted_api` descriptor only while disabled.
Any `enabled: true` registration fails construction. Activation requires a separate
provider-specific change after the corresponding legal review row, exact company configuration and
egress review, immutable artifact publication, deployed contract acceptance, pause-gate proof, and
a new reviewed release flag. This document grants none of those authorities.

Provider contract references:

- [Lever Postings API](https://github.com/lever/postings-api)
- [Ashby public Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api)
