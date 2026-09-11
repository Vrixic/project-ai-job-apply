# Lever global posting v1

This accepted package represents the reviewed `lever-posting-v1` public posting on the global
`jobs.lever.co` host only. It preserves the observed headline/category layout, logo-alt company
fallback, `.posting-categories .workplaceTypes` marker, and a separate JobPosting object with
nullable address fields and no structured posting identifier.

[The HTML](lever-posting-v1.html) is inert. [The JSON](lever-job-posting.json) preserves the
structured field shapes and sanitized description markup without a persistent script element.
Offline extension tests inject that JSON into an ephemeral DOM to exercise the real inspector;
they separately exercise the HTML fallback. The two prose bodies were replaced independently,
so this package makes no claim that their replacement text is equivalent.

The exact-file Biome anchor-rule exception preserves four intentionally inert anchors without
adding live links or changing reviewed payload bytes. Application accessibility rules stay enabled.

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

This acceptance does not cover `jobs.eu.lever.co`, custom domains, application forms, publication,
provider activation, production or store distribution. It is not legal/privacy or security/privacy
sign-off. Those independent gates remain unchanged.
