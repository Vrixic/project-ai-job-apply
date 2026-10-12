# D3 native propagation and replacement — 2026-10-12

D3-119 fixes premature DNS readiness exhaustion. The live original CREATE remained PENDING
after all twelve five-second polls; it later became INSYNC, after the workflow had permanently
skipped attachment. The worker generated successfully, but that packet never acquired its material.

Creation propagation now observes the sole original change for at most 360 polls, stopping at
the original material deadline or positive task retirement. Attachment still rechecks expiry and
owner admission. No DNS mutation, generation, task launch or lifetime is repeated or extended.
Deletion propagation retains its separate bounded observation; unresolved cleanup stays unresolved.
Existing numeric workflow versions retain their original behavior and checkpoints.

D3-120 clarifies that absent material may still be preparing. Checking remains GET-only.
Replacement requires an explicit choice to supersede potentially running preparation, bound
to the current application revision and packet hash. Ambiguous retries retain their exact intent;
new revisions require a fresh choice.

Executed: 58 targeted workflow tests, 50 workspace tests, Workflow build, web typecheck and focused
Biome checks pass. A narrow test-mock type found by the build was corrected before the passing
retry. Regressions cover delayed propagation, original expiry, positive retirement,
bounded polling, single DNS writes and revision-scoped replacement consent.
Consequential review and the simulated connected Chromium journey pass, including preparation,
review, approval, downloads, manual Apply and candidate-attested confirmation/history. Its
authentication, BFF, native service and receiver are simulated. Managed deployment and the
successful live approval/download journey remain required.

The failed live packet was cancelled: its initial response was ambiguous, so a fresh GET was used
without replay and confirmed cancellation. Its worker is positively STOPPED and its DNS record
is absent. Its workflow failed with preparation-incomplete; that is not successful attachment.
No generated content or credentials are included in this record.

Live AI and employer submission remain off behind their existing external gates. Independent
D1/admin acceptance remains deferred. D3 remains In progress.

2026-10-12 follow-up: managed Gateway 108/native preparation 9 review, approval and direct
PDF/DOCX downloads pass. See the [current connected journey](d3-native-connected-journey-2026-10-12.md)
for exact limits and remaining acceptance.
