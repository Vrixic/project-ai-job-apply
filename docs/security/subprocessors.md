# Subprocessor and External-System Register

- Status: Candidate register; procurement, DPA, security, privacy, retention, and counsel review pending
- Last updated: 2026-10-02

| System | Intended purpose | Candidate data | State |
|---|---|---|---|
| AWS | Compute, database, queue, durable execution, encrypted object storage, logs, and, from [ADR-059](../adr/059-live-generation-through-amazon-bedrock.md), model inference for generated resumes and cover letters through Amazon Bedrock in the platform's own account (decided 2026-11-13, not yet deployed) | Confidential and internal | Isolated development and synthetic-staging foundations deployed; accountable approval pending |
| GitHub | Source control and CI | Source and synthetic tests only | Repository active |
| Vercel | Next.js presentation hosting and server-side BFF execution | Synthetic request/session metadata only until real-user approval | Selected in ADR-026; two-project source configuration implemented. Account project creation, exact-host deployment, provider/DPA/region/retention/deletion/incident review, and accountable approval remain pending. No real candidate use is authorized. |
| Temporal Cloud | Retired Phase 0 workflow provider | Historical opaque synthetic workflow metadata only | Access keys revoked; AWS runtime secrets scheduled for deletion; no active product data flow or executable dependency |
| Auth0 by Okta | Authentication and sessions | Minimum identity claims, authentication methods, and session/security metadata | Development tenant and web conformance active for synthetic engineering use; synthetic staging temporarily shares the issuer under ADR-014. Contracting entity/region, DPA, provider review, dedicated real-user tenants, and accountable approval remain pending. |
| AWS CloudWatch / OpenTelemetry libraries | Operational telemetry | Redacted identifiers and measurements | Encrypted CloudWatch logs, traces, metrics, alarms, and alert exercises are deployed; provider/legal-entity terms, access/retention review, and accountable approval remain pending for real candidate data |
| AI model provider (OpenAI) | Short free-text answers drafted in the browser ([ADR-057](../adr/057-narrative-answers-drafted-in-the-candidates-browser.md); resumes and cover letters use Amazon Bedrock instead, ADR-059) (consent through the Terms of Service, which must name the provider and categories before any real-candidate use; provider abuse monitoring may keep prompts up to 30 days) | Confirmed non-restricted career facts and job text only | Owner selected `gpt-6-luna` and accepted limited development data handling on 2026-10-02; [decision and remaining conditions](d3-012-accountable-disposition.md#openai-development-decision-2026-10-02). Default-off adapter only, no live calls or runtime composition. Exact contracting entity/region, contract/DPA/subprocessors, notice/consent wiring, credentials, evaluation and activation remain pending; no general real-candidate or public-launch approval. |
| Email provider | Later approved delivery/outreach sending | Approved message and recipient | Not selected |
| Billing provider | Later subscription and entitlement normalization | Customer/billing identifiers | Stripe proposed, not activated |

Before activation, record provider legal entity, service/data regions, DPA, subprocessors, training
use, retention, deletion method, breach terms, security review, owner, and revalidation date.

## Activation gate

No provider may receive real candidate data, credentials, application content, or external-action
authority until its row includes:

- named service/data owner and accountable security/privacy reviewers;
- exact product, legal entity, service region, and data-residency configuration;
- data categories, purposes, transfer path, access model, and least-data justification;
- contract/DPA, subprocessor list, breach terms, deletion/return process, and audit assurances;
- AI training/retention controls when applicable;
- credentials/scopes, rotation, revocation, isolation, and failure/exit plan;
- tested deletion/export/incident behavior where applicable; and
- approval date, artifact/policy versions, residual risks, and revalidation trigger.

Repository selection or Terraform configuration is not provider approval.

## Candidate-rights executable inventory

The D1 generated-synthetic candidate-rights runtime uses the exact executable subprocessor-adapter
inventory `none`. This does not mean the platform has no external systems. Auth0 is reconciled by
the separately typed identity-provider adapter, while AWS database/object cleanup and backup aging
are first-party owner/infrastructure controls. AWS and Auth0 therefore remain in the disclosure and
activation register above, but neither may be duplicated into the generic runtime adapter CSV.
The current Lambda deliberately rejects a nonempty CSV until a concrete idempotent deletion adapter
is implemented and reviewed.
