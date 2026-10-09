# D3 — High-Quality Application Preparation

Status: In progress. Started: 2026-09-18. Completion: Not completed. Updated: 2026-10-09.

## Task register

Implemented means merged source; deployment and live acceptance are stated separately.

| Capability / task IDs | Implemented | Remaining |
|---|---|---|
| Facts and saved answers (D3-001, D3-039, D3-055, D3-056, D3-075, D3-076) | Fact grounding, encrypted answer storage, selected-version checks and expiry/correction/quarantine guards are locally verified. | Candidate selection/review UI, compatible release and saved-answer reuse acceptance; reuse remains off. |
| Resume import (D3-002, D3-023, D3-024) | Immutable import, normalized resume structure and upload registration are implemented; synthetic scan/parse has development evidence. | Real-resume processing approval and final connected onboarding acceptance. |
| Resume preparation (D3-003, D3-016, D3-022) | Deterministic tailoring, visible diffs, factuality checks and verified PDF/DOCX rendering are implemented. | Connected native generation/download and candidate output-quality acceptance. |
| AI generation (D3-004, D3-037, D3-038) | A gated model adapter, grounded output validation and fresh disclosure checks are locally verified. | Provider configuration, real-model evaluation and live generation acceptance. |
| Applications (D3-005, D3-021, D3-074) | Immutable packets, owner-scoped lifecycle/history, application reopening and approval rechecks are implemented. | Final connected generation, approval, dispatch and confirmation acceptance. |
| Review (D3-006) | Review-by-exception and explicit approve/cancel UI are implemented. | Native material/saved-answer integration and final accessibility acceptance. |
| ATS adapters (D3-007, D3-013) | Provider-neutral extraction, mapping, approved-field planning and challenge detection are locally verified. | Authorized provider fixtures, independent QA acceptance and the first Greenhouse adapter; Lever/Ashby follow later. |
| Submission safety (D3-008) | Attempt idempotency, validation, takeover, ambiguity handling and terminal confirmed-submission history are implemented. | Connected extension submission and provider confirmation acceptance. |
| Assisted/manual Apply (D3-009, D3-018) | Canonical job opening, approved-answer copying and safe manual fallback are implemented; the deployed manual flow passed human review. | Direct native downloads and extension handoff acceptance. |
| Metrics (D3-010, D3-036) | Versioned correction/outcome metrics and strict detached telemetry envelopes are locally verified. | Production sinks/dashboards/alarms are deferred from the candidate-journey critical path. |
| Verification (D3-011, D3-019) | Local adversarial, owner-isolation, duplicate-start and crash/replay checks pass; basic manual Apply is accepted. | Full generated-material journey, installed-extension checks and final security/privacy/accessibility/product acceptance. |
| Capability approval (D3-012) | Engineering approval packet refreshed on October 9 against current source/evidence; existing limited development owner dispositions are linked without amendment. | Provider retention under ADR-038, exact release/source review and accountable legal/security/privacy gates remain; development direction alone does not close them. |
| Candidate rights (D3-014, D3-028, D3-029, D3-030, D3-031, D3-073) | Applications export/delete/restore support, restricted-answer export and document-prefix cleanup are implemented with local and partial managed evidence. | Current deployed document-inclusive deletion/export/restore acceptance and backup-aging/accountable review. |
| Migration/release tooling (D3-015, D3-020, D3-032, D3-033, D3-034, D3-040, D3-041) | Release convergence, provenance guards, dependency corrections and checksum-bound migration/restore tooling are implemented and verified. | Fresh compatible publication and exact managed release/restore checks for the next activation. |
| Resume limits/deletion (D3-025, D3-026, D3-027) | Plan-driven limits, in-progress upload exclusion, deletion and version/prefix byte purge are implemented and accepted in development. | Document-inclusive account-deletion acceptance remains under candidate rights. |
| Cover-letter preparation (D3-017, D3-042, D3-043, D3-044, D3-050, D3-067) | Private initialization, single-dispatch admission, original-work recovery and failure fences are locally verified. | Live provider composition, positive remote settlement, temporary-copy cleanup and candidate preview acceptance. |
| Provider response lifecycle (D3-045, D3-046, D3-047, D3-048, D3-049, D3-057, D3-059, D3-060, D3-061, D3-063, D3-065) | Original-response capture, eligibility, completion/failure settlement and disposal ports are locally verified. | Managed provider behavior, original-writer quiescence, retention and end-to-end cleanup acceptance. |
| Private runtime (D3-051, D3-052, D3-053, D3-054, D3-058, D3-062, D3-066, D3-078) | Isolated control/maintenance/provider bootstraps, artifact publishers and restrictive IAM composition are implemented. | Complete managed release, effective permissions, scheduling/drain and live acceptance for cover-letter work. |
| Preparation workflow (D3-068, D3-069, D3-070, D3-071) | Native preparation activity, durable entrypoint, starter and recovery artifacts are implemented and qualified locally. | Complete connected activation and original-work recovery/drain acceptance. |
| One-off material policy (D3-064, D3-072) | Memory-only storage, bounded expiry, hash-only packet guards and legacy export readers are implemented locally. | Complete no-persistence/30-minute enforcement across provider, browser, ATS and all copies; legacy saved-content paths must remain inactive or be replaced. |
| Restricted packets (D3-077) | Separate-key packet protection and legacy receipt migration are implemented; managed archival of seven receipts passed. | Managed original-request replay, saved-answer reuse and broader candidate/privacy acceptance. |
| Native material session (D3-079) | Native HTTPS/image, route/disposal bindings, preparation/cleanup resources and a bounded backend test driver are implemented; managed resources are deployed disabled. | Controlled sign-in, source/owner activation, live preview/PDF/DOCX, expiry/retirement, browser/CORS and client/ATS acceptance. |
| Connected browser safety (D3-080) | Exact material/hash/deadline guards, explicit generated-material review, boolean sensitive answers, packet-change resets, retry-stable commands, async preparation/scalar-location BFF routes and immediate confirmed-history refresh are locally verified. | Native browser identity/material transport, cover-letter preview/download UI and saved-answer selection remain unfinished; local simulated journey is not live acceptance. |
| Cover-letter request/status UI (D3-081) | Default-off versioned disclosure opt-in, explicit asynchronous requests, retry-stable admission, bounded status polling, current-packet checks and latest-revision cancellation are locally verified, including the full repository verifier and synthetic Chromium checks. Preview availability binds every material-reference scalar, including later versions of the same generation. | Direct native previews/downloads and live generation/cleanup acceptance remain open. |
| Form-plan safety (D3-082) | Conflicting control claims and duplicate normalized options fail closed; challenges produce no fill/attach actions; restricted fields always require candidate action under the adopted D3-013 threshold. All 20 synthetic SDK tests, the synthetic connected Chromium journey and the full repository verifier pass. | Provider fixtures, first adapter integration and live acceptance remain open. |

## Decisions and scope changes

Generated cover letters and tailored resumes must never persist and must expire within 30 minutes (ADR-038).
Manual Apply is the first acceptance path; Greenhouse is the first automated adapter.
Application history ends at confirmed submission; sensitive answers and irreversible actions require candidate review.

## Exit criteria

- [ ] Complete truthful preparation, review, approval, Apply and confirmed-submission history.
- [ ] Verify rendered documents, immutable approval bindings and duplicate-submission safety.
- [ ] Prove no generated-content persistence and all-copy expiry within 30 minutes.
- [ ] Accept supported ATS fixtures/accuracy and safe manual fallback.
- [ ] Complete rights/restore, AI evaluation, accessibility and accountable legal/security/privacy/product reviews.

## Evidence

- [Connected browser implementation and verification, 2026-10-09](evidence/d3-connected-candidate-journey-2026-10-09.md)
- [Current native release, deployment and remaining acceptance](evidence/d3-native-application-disposal-2026-10-07.md)
- [Native preparation composition](evidence/d3-native-application-preparation-release-2026-10-07.md)
- [One-off material policy](../../adr/038-one-off-generated-application-materials.md)
- [Saved-answer packet binding](evidence/d3-vault-packet-binding-2026-10-04.md)
- [Restricted receipt migration](evidence/d3-legacy-receipt-transition-2026-10-08.md)
- [Capability approval packet](../../security/d3-application-approval-packet.md)
- [Provider fixture request](../foundation/d3-provider-fixture-request.md)

Historical checkpoints are retained in Git history and the linked evidence; this document records current status only.

2026-10-09: Implemented and verified D3-080 browser safety batch. Full D3 remains in progress;
native identity transport needs an owner decision and live/provider/accountable gates remain open.
Independent D1 acceptance, including hosted admin acceptance, remains deferred.

2026-10-09: Added D3-081 preparation/status UI without activating providers or sending generated
content through the BFF. Synthetic browser checks cover the opt-in and queued/running/succeeded
path; missing exact cover-letter previews continue to block approval.

2026-10-09: Refreshed the [D3-012 engineering approval packet](../../security/d3-application-approval-packet.md)
to remove obsolete missing-vault/workflow claims and link current protection, native lifecycle,
browser and managed evidence. The named development provider choice remains distinct from
ADR-038 retention approval; no reviewer disposition or release gate was changed.
