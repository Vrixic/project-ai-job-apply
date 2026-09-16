# User-data and privacy disclosure source — draft

Status: engineering-authored disclosure input, not an approved privacy notice or store submission.

## Current default-dark behavior

The packaged candidate has no Auth0 or API host permission and enables no Greenhouse, Lever, or
Ashby variant. It cannot inspect a provider page, authenticate, save, or contribute successfully.
No telemetry or advertising SDK is configured.

## Data the enabled design would process

Only after the user chooses **Inspect current tab**, the bundled reader derives an allowlisted
public-job capture: canonical HTTPS URL, provider/variant and adapter version, capture time, title,
company, location, work type, description, and public external job identifier when present. The
user sees the contribution preview and explicitly commands delivery of all available public fields
by pressing **Add job to shared database**. No second approval checkbox is required.

The extension must not collect or transmit raw DOM/HTML, browsing history, cookies, request
headers, third-party form values, authentication material from the page, private notes, unrelated
tabs, or background browsing activity. This extension surface offers public contribution only.

## Storage and transmission

- Auth0 access/refresh state and the most recent sanitized capture are held in trusted
  `chrome.storage.session` contexts.
- A maximum of 25 sanitized pending intents can be held in `chrome.storage.local`, with a stable
  idempotency key and an account/session fence. Access tokens are not stored in those records.
- Delivery, when separately enabled, uses HTTPS to one exact API origin. Contribution transport
  sends only the selected structured capture and operational identifiers.
- Accepted queue entries are removed. Logout clears all local pending entries and the last capture,
  and configured expiry removes stale items. Manual queue-removal controls are development-only;
  they are not part of the end-user extension or its support instructions.
  Source selects no live duration; accountable review must approve and configure one within the
  enforced 1-hour to 30-day range.
- Ordinary contribution processing retains no raw page snapshot. Server retention, export,
  deletion, withdrawal, and appeal behavior require the separately approved platform policy and
  implemented owner-scoped endpoints.

## Use and sharing

The intended use is the user-commanded public-job contribution feature. The design does not sell
data, use it for advertising, credit, eligibility, or candidate
ranking, or expose contributor identity publicly. Processors and subprocessors must match the final
approved subprocessor register before release.

## Required store-form answers

The accountable reviewer must answer each Chrome/Edge user-data form from the exact final binary,
deployed endpoints, retention behavior, and approved privacy notice. This draft must not be copied
as a blanket certification. Any statement that data is deleted on request, retained for a specific
period, or shared with named processors remains blocked until the behavior and policy are verified.
