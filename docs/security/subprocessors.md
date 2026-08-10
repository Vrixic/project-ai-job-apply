# Subprocessor and External-System Register

- Status: Candidate register; procurement, DPA, security, privacy, retention, and counsel review pending
- Last updated: 2026-08-08

| System | Intended purpose | Candidate data | State |
|---|---|---|---|
| AWS | Compute, database, queue, durable execution, encrypted object storage, logs | Confidential and internal | Isolated development and synthetic-staging foundations deployed; accountable approval pending |
| GitHub | Source control and CI | Source and synthetic tests only | Repository active |
| Temporal Cloud | Retired Phase 0 workflow provider | Historical opaque synthetic workflow metadata only | Access keys revoked; AWS runtime secrets scheduled for deletion; no active product data flow or executable dependency |
| Auth0 by Okta | Authentication and sessions | Minimum identity claims, authentication methods, and session/security metadata | Selected by ADR-012; tenants, contracting entity/region, DPA, security/privacy approval, and activation pending |
| OpenTelemetry/CloudWatch | Operational telemetry | Redacted identifiers and measurements | Local/config definition present |
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
