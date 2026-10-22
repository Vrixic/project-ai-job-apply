# D3 style-preserving generated resume (2026-10-21, local source only)

[ADR-051](../../../adr/051-style-preserving-generated-resume.md). Nothing is released or live-tested.

## What was run

- Documents unit tests: 2,035 passed (80 files), including new tests for layout shape validation,
  PDF layout extraction (sizes, traits, colors, rules, stroked rules under a flipped page, color
  splits, state restore, out-of-order and rotated pages), AST bullet continuation (hanging indent,
  margin heuristic, page gaps, order of mixed sections), the styled renderer (round trip through the
  hardened parser: positions, weight, color, rules, moved and dropped bullets, stretch limits, page
  overflow, refusal of unsupported characters), and the native source validator accepting a laid-out
  document and refusing extra keys. Domain schema tests: 40 passed, including valid and invalid
  layout examples.
- Five resumes supplied by the owner (kept on the owner's machine, never committed) were parsed,
  tailored for an invented job text, rendered and re-parsed. Three (one single column, one that mixes
  columns row by row, one exported from Google Docs) were reproduced with the same line breaks,
  headings, rules, link colors, bullet order changes and spacing, and passed character verification.
  Two had no usable layout (columns whose reading order jumps up the page, text emitted out of
  order) and were drawn as plain text through the fallback, which also verified.
- Renders were compared with the originals in Chrome through PDF.js (standard fonts available).

## Not run

The Linux native-process scenarios (Docker), a governed parser or native image release, live
generation, the extension transfer of a styled PDF, DOCX layout, and independent security/privacy
review. Known visible differences: typeface (standard fonts), weight that was only simulated by the
exporter, rounded bullet marker, dropped images and link annotations.
