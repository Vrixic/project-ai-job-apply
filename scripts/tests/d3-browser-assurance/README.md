# D3 local browser assurance

Run `pnpm test:d3-browser-assurance` after installing root development dependencies. The bounded
runner bundles the production Applications workspace, serves it on loopback, and uses generated-
synthetic BFF responses in a locally installed headless Chrome. It exercises the candidate's manual
submission recording action, the existing submitted attestation path, stable idempotency data,
keyboard activation, and automated WCAG rules before and after the state transition.

The runner never downloads a browser, contacts an employer, dispatches a submission, uses a real
identity, or retains candidate data. This is local browser evidence only. It does not establish
managed-OIDC, deployed Gateway/database, provider, legal, privacy, security, human accessibility,
assistive-technology, or real-candidate acceptance.

The same workspace journey exercises approved PDF/Word transfer and explicit withdrawal using
production UI/client code with a synthetic Chrome receiver. Native/BFF/identity responses are
simulated; this proves no installed extension, provider attachment or automated submission.
Transport unit/composition tests independently cover exact source/destination documents, owning
reads, single-use admission, lost acknowledgements, original expiry and immediate buffer disposal.

`node scripts/tests/d3-browser-assurance/greenhouse.mjs` exercises the internal Greenhouse
inspection/filling primitives in installed headless Chromium. All requests are intercepted locally
with generated synthetic HTML and simulated approval/registry authority. It verifies synchronous
employer-handler changes, exact just-written values and native validation; there are no uploads,
submission clicks or installed-extension/live-provider acceptance claims.

`node scripts/tests/d3-browser-assurance/greenhouse-execution.mjs` exercises 23 synthetic
execution cases with actual browser File/DataTransfer controls, one simulated submission click,
exact accepted-profile simulation and fresh challenge-first confirmation. It checks substituted
files, cancellation, stalled hashing, structure/value changes and missing confirmation. Requests
are intercepted and form submission is prevented: zero actual uploads or external submissions.
The background and content-entry regressions separately cover write-ahead dispatch, lost
acknowledgements, exact proof ownership and complete payload disposal during stalled hashing.

`node scripts/tests/d3-browser-assurance/ashby-execution.mjs` runs 8 synthetic cases against a page
shaped like a public hosted Ashby posting (no form element, Yes/No button pair, sibling submit
button, invisible reCAPTCHA badge) with a real File/DataTransfer resume attach, one submit click
and in-place confirmation. It also checks the off switch, an unanswered required question, a
changed form, a challenge before and after the click, a missing confirmation message and an
unexpected navigation. Requests are intercepted: zero uploads or external submissions.

## Try the generate-then-apply flow by hand

`pnpm playground:d3-apply` (opens your browser) serves the production candidate
workspace at `http://127.0.0.1:4177/` with the same synthetic BFF, native and extension responses the
runner uses. Pick a scenario in the bar (generation succeeds quickly or slowly, fails with retry,
no uploaded resume, never finishes); it searches and opens the job for you. Use "Show recorded
requests" to see the BFF calls Apply makes, and the extension buttons to simulate an installed or
missing extension. Apply opens a blank synthetic employer tab. No AWS, Docker, Auth0 or employer
request is made; stop with Ctrl+C.
