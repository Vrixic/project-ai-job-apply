---
name: guard-product-architecture
description: Apply the platform's product scope, architectural boundaries, security model, privacy rules, and accepted decisions. Use when proposing or reviewing services, data flows, AI behavior, browser automation, ATS adapters, UGC ingestion, identity, outreach, notifications, mobile or extension capabilities, reliability, scaling, or any cross-cutting design and threat-model change.
---

# Guard Product Architecture

## Load authoritative context

Read only the relevant sections of:

- `../../docs/PRODUCT_AND_SYSTEM_ARCHITECTURE.md`
- `../../docs/adr/README.md` and applicable accepted ADRs
- `../../docs/security/README.md` and applicable security documents
- `../../docs/product/delivery/DELIVERY_TRACKER.md` for delivery reality

Inspect current code before presenting a design as implemented. Treat accepted ADRs as historical
records; supersede them with a new ADR rather than rewriting them.

## Enforce invariants

- End product behavior at confirmed application submission.
- Exclude coaching, interview preparation, inbox/calendar reading, and post-submission hiring
  outcomes.
- Ground candidate facts and generated answers in verified evidence.
- Require user review for sensitive, uncertain, unsupported, or materially changed answers.
- Never bypass CAPTCHA, MFA, rate limits, or provider restrictions.
- Bind approval to an immutable application packet and prevent duplicate submission.
- Collect minimum data; keep production PII, tokens, resumes, and page bodies out of logs,
  analytics, fixtures, and events.
- Keep frontends behind versioned contracts and services behind clear data ownership.
- Use durable workflows for long waits and external effects; require idempotency and auditability.
- Isolate ATS/provider failure domains and provide takeover, fallback, health, and kill switches.
- Use synthetic data until legal/privacy gates approve representative data.

## Evaluate a decision

1. Identify the owning bounded context and data owner.
2. Draw the trust boundary and external side effects.
3. Classify processed data and required consent.
4. Define synchronous versus durable behavior and degraded operation.
5. Specify idempotency, retries, cancellation, audit events, and observability.
6. Identify authorization scopes and tenant/user ownership enforcement.
7. Test failure isolation, deletion/export, and provider outage behavior.
8. Prefer the simplest robust deployable shape; do not create a service solely because a folder
   exists.
9. Record a new ADR for a consequential or cross-cutting change.
10. Update the threat/data-flow documents for new user-visible automation or sensitive data.

Do not prioritize estimated implementation speed or cost over quality, simplicity, robustness,
scalability, or maintainability.

## Review output

Lead with compatibility or violation, then name affected boundaries, failure modes, required
controls, and evidence. Separate legal-review dependencies from technical recommendations; never
self-certify legal approval.
