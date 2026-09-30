# ADR-035: Restricted Answer Values in Candidate Export

- Status: Accepted for generated-synthetic engineering by the product owner; legal/privacy and security approval pending
- Date: 2026-09-30
- Clarifies: ADR-010 and ADR-027's export boundary; does not authorize real-data activation

## Context

Profile's encrypted Restricted Answer Vault retains append-only versions. Its SQL export returns
latest-version metadata only, and the ordinary Gateway settings routes never return saved values.
Candidate portability therefore needs a separate narrowly authorized decryption path, not a
plaintext database projection or a general-purpose vault-read endpoint.

## Decision

The owner approves export of the latest non-deleted candidate-supplied answer, including an expired
answer. Expiry prevents reuse in an application; it does not erase retained candidate data.
Superseded values are not exported. Deleted entries remain metadata-only tombstones, even though
their immutable historical rows still carry ciphertext. Credentials, tokens, session material,
signatures, attestations, and technical challenges remain excluded.

The existing fresh-authentication, owner-scoped candidate-rights request and durable activity
build the same encrypted, short-lived, exact-object portable artifact. Profile owns the queries.
A decrypt-only reader binds the candidate, entry ID, field, optional context, and exact latest
active version from the metadata snapshot. It refuses a mismatched or deleted entry and rechecks
the reference after KMS decryption. No SQL lock is held during KMS I/O. A detected snapshot change
fails assembly before an artifact write and is retryable against a newly read metadata snapshot.
Exports are point-in-time reads, not a promise to reflect corrections made after their read.

The private candidate-rights activity receives a separate default-off activation flag and the
dedicated vault key ARN. Its IAM grant permits only `kms:Decrypt` on that exact key, with the
existing `restricted-answer-vault-v1` encryption-context purpose. The adapter additionally binds
the exact candidate, field, and context and refuses a stored or returned key mismatch. It validates
bounded UTF-8 output and replaces provider error messages with fixed codes. No vault plaintext
enters SQL, events, durable input/history, general logs, analytics, or ordinary HTTP responses.
The only output containing a saved value is the candidate's encrypted rights artifact.

Portable format v1 adds an optional string `value` to active `profile.restrictedAnswers` entries.
Older metadata-only artifacts remain valid. Deleted entries must not contain `value`. The SQL
owner projection remains metadata-only; the activity refuses values in that projection before
invoking the separately authorized reader.

## Rollout and consequences

There is no migration or backfill. Default-off releases retain metadata-only export. Publish the
new immutable worker artifact, capture a current zero-drift baseline, and use the bounded activity
refresh with the additional export activation switch. The owner separately reviews the saved plan
and its hashes before any apply. The mode permits only the existing activity release chain plus
the exact rights-role statement and two activity environment bindings, verifies the live chain and
policy, and requires post-apply zero drift. No public API or Gateway permission is added.

Generated-synthetic database and mocked-KMS tests are engineering evidence, not live KMS, hosted
candidate-rights, legal/privacy, security, or D1/D3 completion acceptance. Accountable reviewers
must still assess the artifact's restricted-data classification, retention, deletion, and access
controls before real candidate processing.
