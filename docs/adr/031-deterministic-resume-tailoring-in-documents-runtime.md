# ADR-031: Deterministic resume tailoring in the Documents runtime

Status: Accepted (owner, 2026-09-28); implemented and locally verified, not yet exposed in the deployed hosted app
Date: 2026-09-19

## Context

Preparing an application must attach a job-specific resume, and the candidate must see what changed
before approving. Resume text is confidential PII that may be read only by the candidate and an
approved renderer, model, or ATS workflow ([data flow](../security/data-flow-and-classification.md)).
The normalized resume lives in a private KMS-encrypted object and is readable only by the document
parser and coordinator roles ([ADR-022](022-quarantine-and-scan-candidate-document-uploads.md),
[ADR-023](023-isolate-untrusted-document-parsing.md)). The Gateway is a request-routing runtime; it
must not gain read access to resume text. Tailoring (D3-003) is a deterministic function: it selects
and orders verbatim base bullets by job-term overlap and never adds or rewords text.

## Decision

1. Tailoring runs inside the Documents runtime (the document processor Lambda), which already owns the
   normalized-object read path, the KMS grant, and the owner-scoped database access. The Gateway
   invokes it through one fixed synchronous request kind, `resume-tailoring-v1`, validated strictly.
2. The request carries only the owner identity resolved by the Gateway, an optional document id, and
   the public job title and description. The runtime resolves the newest `parsed` resume owned by that
   identity, verifies the normalized object exactly as the coordinator does, and never reads another
   owner's document.
3. The response contains the base document identifier and file name, the tailoring version, the
   content hash, a fixed-reason visible diff, and optionally the rendered DOCX and PDF bytes. Rendering
   is byte-for-byte reproducible and verified by re-parsing.
4. **No tailored resume is persisted.** The packet stores only the content hash. Because tailoring is a
   pure function of the immutable base document, the job text, and the tailoring version, the same
   inputs reproduce the same hash. Any change to the resume, the tailoring version, or a job text that
   alters the resulting resume changes the hash and invalidates approval through the existing packet
   rules; a job-text edit that leaves the resulting resume identical does not. This adds no candidate text to
   PostgreSQL and no new object, so candidate export, deletion, and restore are unchanged.
5. The content hash is taken over the materialized ordered blocks, independent of file format, so DOCX
   and PDF renderings of one tailoring share one approval binding.
6. The Gateway receives resume text only in the owner's own response for the review screen and
   download. It must not log or persist it, and its logs continue to carry method, path, status, and
   timing only.
7. Generative rewrites and cover letters are a separate path (ADR-030) and remain blocked on D3-012.
8. **The normalized resume AST (D3-002) is never persisted either, for the same reason.** The AST
   (`resume-ast/types.ts`, `astVersion: "resume-ast.v1"`) is a deterministic, total mapping from one
   immutable normalized document to sections and entries; it depends only on that document and is
   recomputed from it on every read, the same way the tailored resume is recomputed from the AST.
   Every current consumer (tailoring today; the structured-profile resume import planned in D3.1)
   already reads it this way. If a consumer ever needs the AST independent of a live document read
   (audit, offline analysis, an extension that cannot call the Documents runtime), that is a new
   decision, not an oversight in this one.

## Consequences

- The Gateway role needs `lambda:InvokeFunction` on the exact processor alias, and the Lambda VPC
  endpoint policy must allow it. The processor keeps its two reserved concurrent executions, so heavy
  tailoring competes with scan processing; raise the cap by evidence, not in advance.
- Each preparation and each approval check re-runs tailoring (sub-second, deterministic), instead of
  reading a stored artifact. This trades a small amount of compute for zero stored candidate text.
- A resume deleted or replaced after preparation changes or removes the hash, so approval expires.
- If per-version storage is later needed (for audit or the extension), it must join candidate export,
  deletion, and restore under a new decision.

## Rejected alternatives

- **Read normalized resumes in the Gateway.** Rejected: widens the Gateway's blast radius to resume text.
- **Persist tailored versions in PostgreSQL.** Rejected for now: stores candidate text and forces new
  candidate-rights, export, and restore work without a product need.
- **A new dedicated tailoring Lambda.** Rejected for now: duplicates the normalized-read grant, the
  database grant, and the release pipeline for no isolation gain over the existing coordinator.
