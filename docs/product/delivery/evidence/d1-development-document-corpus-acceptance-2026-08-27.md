# D1 development document corpus acceptance — 2026-08-27

## Outcome

The fresh generated-only adversarial document corpus passed against exact deployed release source
`48f5d5ba0c2339ec45a818a4c461676ad9ef9191` at development state serial `230`. Independent
`CorpusVerify` accepted the sealed result.

The accepted records are bound by these SHA-256 values:

- execution plan: `8ee9525ad43f71e16886fe2f4e0d79ff77072e06e113a5df9ef3c6aa6f0edd03`;
- corpus: `be33e8e72e3ee0de4ac544227a9cacec654663cb4ccbcb7fa66d1eaa9a975cf6`;
- sealed receipt: `5679625505f76e9d5be2ecbd591d7023937c9f8c828b5286bd95eebfa3fedc5e`;
  and
- aggregate result: `5986e3fc3d85d1db0d27a86bf1414e7f68b66121bb7fdb7c70ab4584a0c2f869`.

## Aggregate result

- Cases executed: `43`.
- Cases rejected at the reviewed parser boundary: `43`.
- Persistent database rows created: `0`.
- Database access by the corpus workload: `false`.
- Exact generated object versions removed: `true`.
- Processing triggers enabled: `false`.
- Real candidate data used: `false`.
- Verification cloud mutation: `false`.

The corpus covers bounded PDF and DOCX envelope, package, active-content, encryption, expansion,
relationship, path, XML, parse, and page-limit rejection families. The shared record retains only
the aggregate reason-code counts; it does not retain generated document bytes, object identities,
candidate values, request bodies, or parser output.

## Scope and remaining gates

This closes the deployed generated-only adversarial-corpus execution portion of ADR-023 item 5. It
does not authorize document-processing triggers or real resumes, and it does not complete the
separate deletion/export/restore disposition in that item. The AWS-managed DNS residual-risk
decision, attributable product and security/privacy acceptance, trigger activation, managed-OIDC
browser coverage, and human accessibility review remain open. Phase 1 remains `In progress`.
