# Subprocessor and External-System Register

- Status: Candidate register; procurement, DPA, security, privacy, retention, and counsel review pending
- Last updated: 2026-08-25

| System | Intended purpose | Candidate data | State |
|---|---|---|---|
| AWS | Compute, database, queue, durable execution, encrypted object storage, logs | Confidential and internal | Isolated development and synthetic-staging foundations deployed; accountable approval pending |
| GitHub | Source control and CI | Source and synthetic tests only | Repository active |
| Vercel | Next.js presentation hosting and server-side BFF execution | Synthetic request/session metadata only until real-user approval | Selected in ADR-026; two-project source configuration implemented. Account project creation, exact-host deployment, provider/DPA/region/retention/deletion/incident review, and accountable approval remain pending. No real candidate use is authorized. |
| Temporal Cloud | Retired Phase 0 workflow provider | Historical opaque synthetic workflow metadata only | Access keys revoked; AWS runtime secrets scheduled for deletion; no active product data flow or executable dependency |
| Auth0 by Okta | Authentication and sessions | Minimum identity claims, authentication methods, and session/security metadata | Development tenant and web conformance active for synthetic engineering use; synthetic staging temporarily shares the issuer under ADR-014. Contracting entity/region, DPA, provider review, dedicated real-user tenants, and accountable approval remain pending. |
| AWS CloudWatch / OpenTelemetry libraries | Operational telemetry | Redacted identifiers and measurements | Encrypted CloudWatch logs, traces, metrics, alarms, and alert exercises are deployed; provider/legal-entity terms, access/retention review, and accountable approval remain pending for real candidate data |
| AI model provider | Later structured extraction/tailoring | Minimum required candidate/job context | Not selected |
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
