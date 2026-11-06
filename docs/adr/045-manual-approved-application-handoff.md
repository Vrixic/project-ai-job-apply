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

## Amendment: the panel opens when Apply is pressed (2026-11-06)

Owner direction: the extension should appear on its own after Apply. The browser opens a panel
only in the turn of a click, and the website's Apply handler waits on the network before it
arms the extension, so the website sends a separate request in the click's own turn:
`application-open-panel.v1`, exactly `{ "schema": "application-open-panel.v1" }` and nothing else
(no identifier, page or data). The extension handles it first and synchronously, opens the side panel
for the sender's window, and answers `application-open-panel-receipt.v1` with whether the browser
agreed. It is accepted under the same sender rules as the apply intent: the website's own origin,
its top document, active, a normal (not private) window, and no extension sender. Nothing waits for
the answer; without the extension or its panel Apply is unchanged. The request must be sent
before the website opens the employer tab: `window.open` uses up the click, and Chrome then refuses
the panel ("may only be called in response to a user gesture"). Edge does not enforce this, so it
is not a test of it; Chrome 157 accepts the open from this message when it is sent first and
refuses it when sent after `window.open`.

Opening the panel does not give the extension the employer page: that access is still the
`activeTab` grant, which only the toolbar icon click gives (checked: with the panel open and no
click, script access to the new tab is refused and its address stays hidden). So the panel opens
beside the employer page, tells the candidate their application is ready and to click the icon once,
and the armed application notifies an open panel so it can say so. Standing access to the provider
sites would remove that click but is a permission change for the owner to decide; none was made
here (see the next amendment).

## Amendment: provider sites held by the unpacked execution build (2026-11-06)

Owner decision (asked, then approved with "yes"): so the extension appears and can fill the employer
page right after Apply with no icon click, the unpacked application-execution build holds the exact
HTTPS sites of the providers it switches on as `host_permissions`: Greenhouse
(`boards.greenhouse.io`, `job-boards.greenhouse.io`) and Ashby (`jobs.ashbyhq.com`). Lever has no
fill adapter and no host. There is no wildcard, no `<all_urls>`, no optional host, no persistent
content script, and `activeTab` stays for any other page.

This reverses the earlier rule that provider pages open only through an icon click, and only for the
unpacked build the owner loads: the default-dark and store builds get no provider host (the release
packager refuses any host permission, and the D2 assurance check refuses provider hosts and external
messaging in the product build). Everything that decides what is filled is unchanged: the website's
explicit Apply with approval of the exact packet, the extension's own session and packet re-read, the
exact employer-URL binding, document and tab proof before any write, fill-only versus submit, and the
kill switches. Access to a site means the extension can read and script a page there; it still acts
only on the one page selected for the application. A panel that sees a page still opening waits
quietly; one that cannot see the page says the application is ready and that the icon click opens it.

Checked in Chrome 157 and Edge: after the Apply click opens the panel and the employer tab loads,
the extension sees its address and can script it with no icon click, while the website tab and other
tabs stay refused. The host list derives from the providers named in the build, with tests.

The panel prepares the page only once it has finished loading and gone quiet, and prepares it again
whenever the page reloads: a reload is a new document, so the extension drops what it selected for
the old one (Greenhouse's page loads twice in a row, which made the first selection vanish before the
candidate pressed Fill). The panel says "Filling in your application" while a fill runs.

## Amendment: the panel shows "preparing" until the review link is set (2026-11-06)

Owner direction: the panel opened at the Apply click with an empty "Application review link", because
the website prepares and approves the application, and arms the extension, seconds later. The panel
cannot simply open later: the browser opens it only in the turn of a click, and re-enabling a
disabled panel does not bring it back (checked in Chrome 157). So it still opens at the click, but
the background remembers for 90 seconds that the website asked for it and has not armed the
extension (memory only; `application_pending_intent` answers `preparingUntilMs`). While that holds
the panel shows only "Preparing your application", with no review link and none of its other cards;
it fills in by itself, with the link set and the employer page selected, when the website arms the
extension. If nothing arrives it returns to the ordinary panel at the end of the window. The
request carries nothing, so a page that sends it can only make the panel say it is preparing.

The review link is set on the panel the moment the website arms the extension, not when the employer
page has finished loading: the panel is shown only with the link in place, and then says it is
waiting for the page. It prepares a page that is still loading after six seconds anyway (a reload
prepares it again), polls a blank tab for at most thirty, and leaves a link the candidate pasted
themselves alone. Select, Fill and Apply do nothing, and say to press Apply on the website, while the
link is empty (an empty link made "Use this employer page" stop at its first step, `employer-tab`).

