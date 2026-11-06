# ADR-045: Manual approved application handoff

Status: Proposed; default-off implementation, release acceptance pending
Date: 2026-10-09

The candidate copies an opaque first-party application/job review link into the extension while
viewing the matching employer page. The extension reads the approved packet through existing
owner-scoped APIs with its own public-client session and `applications:read`. It never receives
the confidential web token or the separate browser-native material credential from ADR-044.
No external messaging bridge, new host grant or content script is added. Enabled handoff builds
request write-only `clipboardWrite`, because owner/expiry rechecks can outlast the browser's user
gesture window. Default-off builds retain their existing permissions; no clipboard read is granted.

Every preview and copy validates strict v1 responses, exact application/job IDs, current canonical
job revision and exact HTTPS source URL, packet revision/hash, approval ID and expiry, and absence
of active/ambiguous attempts. Temporary materials require current scalar authorization for each
original generation; content remains in the browser-native workspace. A final protected packet
read rechecks owner, saved-answer references and approval after those asynchronous checks.
Each HTTP read refuses redirects/cookies/cache and is capped at ten seconds and 512 KiB.

The popup holds only reviewed candidate field values in memory. Its preview lasts at most 60
seconds and never exceeds original material, approval or saved-answer expiry. Background memory
holds only binding identifiers/deadline, never a value queue. Every copy repeats the owner reads
and checks the captured tab and account before returning one answer. Restricted answers require
an explicit unchecked-by-default question/context confirmation for each copy. Preserve `false`
as “No”; exclude generated fields, documents, challenges, signatures and attestations. No fill,
upload, employer request, submission, automatic retry or history mutation is performed here.

Clear on logout/login, identity change, page exit/hidden state or expiry; fence late work. Logical
disposal cannot guarantee physical JavaScript string erasure. Clipboard copies are candidate
controlled and outside platform deletion. The candidate returns to the exact application review
to record manual submission, then explicitly confirms the outcome through the existing flow.
An unavailable or mismatched application never falls back to another packet or creates one.

Both clients default off. The extension build requires an exact HTTPS website origin and configured
public identity/API. Store packaging refuses enabled handoff from either configuration source.
Deploy compatible existing packet/job/material-authorization routes before controlled activation;
strict readers refuse unsupported shapes. No REST schema, migration or approval policy changes.
Static validators are generated from authoritative OpenAPI at build time for MV3 script CSP.

Local regressions and Chromium use synthetic credentials, Chrome APIs and API responses. They
exercise production handoff code and real clipboard behavior under restrictive script CSP, but
do not accept installed Chrome/Edge identity, live native expiry, provider forms or submission.
Saved-answer selection UI and the first provider adapter remain separate unfinished D3 work.
Accountable privacy/security/product release gates and independent D1 deferral remain unchanged.

## Amendment: provider application subpages (2026-10-15)

Owner-approved after the installed-extension test. Ashby and Lever host the application form on a
subpage of the posting (`<posting>/application`, `<posting>/apply`), usually with a tracking query,
so the exact source-URL rule refused every handoff and question capture for those providers.
The bound employer page is now the exact HTTPS source URL, or that same posting's provider
application subpage on the same origin (Ashby `jobs.ashbyhq.com` and global Lever `jobs.lever.co`
only). A subpage is recorded without its query; fragments, credentials, other paths, postings,
providers and origins still refuse. One shared `employerPageForSource` check in
`@ai-job-apply/ats-sdk/observed-form` serves the extension and web. The Greenhouse execution
path keeps its exact-URL binding.

## Amendment: apply-time arming (2026-10-20)

[ADR-050](050-generate-then-apply-flow.md) adds an identifiers-only `application-apply-intent.v1`
message so the popup can offer the matching application without a pasted link. The packet is still
read with the extension's own session; the review link remains the identity of the website page.

## Amendment: the extension is a side panel (2026-11-05)

Owner direction after the Greenhouse fill test: the extension is pinned to the right of the window,
top to bottom, like other job-application assistants, instead of a toolbar popup that closes when
the candidate clicks the employer page. The toolbar icon opens the browser's side panel
(`chrome.sidePanel.open` in the click's own turn); there is no `default_popup`, and the popup
surface and `popup.html` are removed. The panel's width is set and remembered by the browser; the
candidate can drag it.

No permission or host access changes: the same `activeTab` grant is given by clicking the icon on
a page, and nothing else is granted. A panel that stays open across tabs must not act on a page it
cannot see, so it follows the active tab (tab switch, finished load, address change, window focus)
and the background tells an open panel when the icon was clicked on a page. On a page the extension
cannot see the panel selects nothing and asks the candidate to click the icon there; it never
clears an earlier selection because of a tab it cannot see. A preview belongs to the page it was
made from and is dropped when the candidate moves to another page. The message that tells the
panel is accepted only from the extension's own background. Trust, approval, binding and
fill-only/submit rules are unchanged.
