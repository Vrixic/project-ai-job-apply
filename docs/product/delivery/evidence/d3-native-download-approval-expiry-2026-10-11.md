# D3 native download approval expiry — 2026-10-11

D3-110 closes a stale-browser approval race in native PDF/DOCX downloads. A page could retain
`ready_to_submit` after approval expired while the material and short-lived sign-in remained valid.
Native read authorization intentionally permits current-packet previews before approval, so that
read proof alone did not authorize the UI's approved download.

Downloads now require a finite, unexpired approval matching the current packet and check the
original approval/material deadline before reading and after asynchronous hashing. Approval expiry
aborts pending files, wipes decoded buffers, withdraws an acknowledged extension transfer and hides
download/transfer controls. Previews retain their original lifetime for fresh review; the page
directs the candidate to Edit again. No deadline is extended or submission inferred.

52 focused native component/client/session tests pass, including stale suspended-tab PDF/DOCX
clicks, expiry during hashing and expiry after extension acknowledgement. Web typecheck and changed
file lint pass. The simulated Chromium search → Prepare → review → approve → manual Apply →
candidate confirmation/history journey passes, including native review, downloads, withdrawal,
expiry and accessibility. Authentication, remote services and extension receiver are simulated;
there is no employer request, installed-extension acceptance or live generated-material claim.

Consequential source review passes. Logs and the review receipt remain under the ignored
`.tmp/d3-primary-recovery-20261010/` directory. Compatible hosted release and live acceptance remain.
Independent D1/admin acceptance stays deferred; D3 remains In progress.

The owner has repaired Docker again; engine 29.7.2 and development access are verified for the next
image-publication batch. AWS runtimes remain off at this checkpoint. Docker is in use for that batch
and must be shut down with WSL before handoff; the PC stays on.
