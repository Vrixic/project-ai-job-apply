# D3-023: Document processing activation (design for the owner to review)

- Status: **Proposed. Nothing has been changed or enabled.** Prepared 2026-09-20 at the owner's request.
- Task: D3-023 in the [Phase 3 record](../product/delivery/phase-3-application-preparation.md). Depends on D3-016 and D3-020, both deployed.
- Goal: a candidate uploads a resume, it is malware-scanned and parsed into proposed facts, and the "Your resume for this job"
  section can then show a tailored resume. Today it can only say there is no resume.

## Where things stand

| Fact | State |
|---|---|
| Document runtime | Deployed, stage `complete-dark`: parser version 7, processor version 12, one receipt |
| Scan trigger (GuardDuty rule, `document_scan_event_rule_enabled`) | Disabled |
| Processor mapping (SQS to processor, `document_scan_mapping_enabled`) and 15-minute timeout reconciler | Disabled |
| Existing operators | Every one asserts the triggers stay off; the acceptance operator proves only GuardDuty service scanning with `TriggerActivation=false`. **No operator or guard can enable them** |
| Proven so far | GuardDuty service scanning and managed tagging (acceptance operator) and the parser's own tests. Not proven: EventBridge delivery, SQS delivery, the mapping, the processor-to-parser trigger path, the reconciler |
| Owner's profile | No resume uploaded ("No Resumes uploaded yet") |

## The boundary that shapes the plan ([ADR-023](../../adr/023-isolate-untrusted-document-parsing.md))

The owner accepted the architecture and the AWS DNS covert-channel residual risk **only for generated-synthetic development
processing**. Real resumes stay blocked until all of these hold: candidate-rights execution, deletion, export, and restore
reconciliation, an accepted DNS-control treatment, and a final attributable security, privacy, and product review. The accepted
activation order is fixed: the mapping and reconciler first, and only after they pass a later reviewed plan enables the GuardDuty rule.

The owner's own real resume is therefore not covered by the current authority, even though the owner is the only candidate. That is
a security-control question (a compromised parser could leak through DNS), not a question of how sensitive the resume is.

## Stage 1: prove the full path with a generated-synthetic resume (inside the accepted authority)

1. **Build the missing activation tool.** Add an activation action to the Gateway release operator (or a small dedicated operator)
   with a guard that accepts exactly the reviewed changes and nothing else: the event-source-mapping `enabled` flag and the reconciler
   rule state for the mapping step, then the GuardDuty rule state for the rule step. Every other resource, variable, and output stays
   pinned. Each step is a saved plan with a SHA-256 that the owner reviews before apply. This is a guard change and needs the owner's
   explicit approval, with tests that reject every other change, as in D3-020.
2. **Mapping and reconciler first.** Apply the mapping step, then prove it with one direct synthetic queue message: the processor
   consumes it, invokes only its numeric parser pin, and leaves no content in logs, the dead-letter queue, or transport. Confirm the
   reconciler runs and the dead-letter queues are empty.
3. **Then the GuardDuty rule, for a bounded window.** Apply the rule step, have the owner upload one **generated-synthetic** resume
   through the web app, and confirm scan, parse, proposed facts, the confirmed-fact review, and a tailored resume in the Applications
   section. Then apply a reviewed plan that turns the rule and mapping back off unless the owner decides otherwise.
4. **Record** the evidence and residual risks in the delivery records and the runbook.

Rollback at any step is the reviewed inverse plan (switches back to false), which the tool must also accept; a disabled rule and mapping
restore today's behavior. The bounded window is the technical control for "synthetic only": the platform cannot tell a synthetic resume
from a real one by content, so real uploads are prevented by keeping the rule off outside the window and by the owner uploading only
generated data during it.

## Stage 2: the owner's real resume (needs everything ADR-023 lists)

| Gate | What engineering can do | What only people can do |
|---|---|---|
| Candidate-rights execution | Activate the confirmed `d3-development-synthetic-v1` policy in a Gateway release (now possible after D3-020) | Owner decision to activate |
| Deletion, export, restore reconciliation | Extend and test export, deletion, and restore replay for source and normalized document objects | Accept the evidence |
| DNS-control treatment | Propose concrete options (for example egress control or resolver policy) with tests | An independent review must accept a treatment (ADR-020 defers independent security review to D6-015) |
| Final attributable review | Prepare the evidence packet | Named accountable reviewer's disposition |

The D3-012 disposition ([record](d3-012-accountable-disposition.md)) covers the owner's own account for development but does not amend
ADR-023, so it does not lift this gate by itself.

## Decisions requested

1. **Stage 1 scope:** approve the bounded generated-synthetic window described above.
2. **Approve building the activation tool and its guard** (explicit approval is required for each guard change).
3. **Stage 2 direction:** pursue the ADR-023 gates now, or leave real resumes blocked until launch review (D6).

## Not in scope

Any real candidate data, staging or production activation, AI or OCR extraction (ADR-023 defers both), and cover-letter generation.
