# ApplyDash Job Capture — store listing draft

Status: copy draft only; do not upload or publish.

## Short description

Preview public job details before adding them to a shared, verified job database.

## Detailed description

ApplyDash Job Capture is designed to inspect only the current job page you explicitly choose. It
shows the structured public fields it detected and separates location from work type. Pressing
**Add job to shared database** sends all available captured public fields. That button is the explicit
command; there is no separate private-save mode or redundant approval checkbox.

The design uses temporary current-tab access rather than persistent browsing access. It does not
request browsing history, cookies, broad website access, or remote executable code. Delivery is
bounded and idempotent so a suspended browser worker or temporary connection problem does not
silently duplicate an intent or assign it to a different signed-in account.

## Current release-candidate limitation

This synthetic/default-dark build has all provider variants and network hosts disabled. It is for
repository and installed-browser assurance only and does not currently provide functional job
capture or public contribution. It must not be submitted as a functional public
listing.

## Assets still required

- Final approved product name and publisher identity
- Final approval of the candidate icon set and text-free 440-by-280-pixel promotional tile; the
  optional 1400-by-560-pixel marquee image remains omitted
- Chrome and Edge screenshots of the exact end-user build, excluding development-only delivery
  queue/shared-history panels and any synthetic-only or unsupported claims
- Approved privacy-policy URL and monitored support channel; the hosted support-route candidate is
  `https://ai-job-apply-candidate.vercel.app/extension-support`
- Category, locale, territory, pricing, and accessibility dispositions

No statement about provider support may be added until the exact variant has authorized sanitized
fixtures, independent QA representativeness acceptance, and an enabled reviewed release policy.
