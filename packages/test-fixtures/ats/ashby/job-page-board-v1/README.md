# Ashby hosted job board v1

This accepted package represents only the reviewed `ashby-job-board-v1` public posting on
`jobs.ashbyhq.com`. [The HTML](ashby-job-board-v1.html) intentionally preserves the observed
loading shell; it does not invent a rendered heading or description.
[The separate JobPosting JSON](ashby-job-posting.json) retains the observed structured
organization, PropertyValue identifier, address, remote-work marker and description hierarchy.
Its other fields are sanitized evidence, not additions to the extension's collection allowlist.

Offline extension tests inject the JSON into an ephemeral DOM and call the real inspector and
detector. The shell alone must yield no detected job. No scripts, network attributes or application
form are retained, and these tests do not claim to execute or reproduce provider hydration.

The user supplied the exact source for fixture capture/sanitization and on 2026-09-11 separately
accepted sanitized content and representative structure. Both decisions are attributed to the
same opaque product-owner reviewer, not fabricated different reviewers. Gitleaks `8.30.1`
reported no findings; Presidio Analyzer `2.2.364` passed after exact-context adjudication of
synthetic and standard-vocabulary findings. The initial and adjudicated reports remain private.
These payload bytes are unchanged from the scanned, user-reviewed copies.

Raw responses existed only in bounded, unauthenticated inspection-process memory; no raw file was
created or retained. The manifest's raw-capture disposition records the end of those processes,
not deletion of a disk capture. Source authorization is due for revalidation on 2026-12-10,
or earlier upon revocation or source/policy change.

This acceptance does not cover custom domains, application forms, publication, provider activation,
production or store distribution. It is not legal/privacy or security/privacy sign-off. Those
independent gates remain unchanged.
