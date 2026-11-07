# ADR-051: Style-preserving generated resume

Status: Proposed (owner-directed 2026-10-21); locally verified source; parser and native image
releases and live acceptance pending
Date: 2026-10-21

Decision 3's rule that the original file is never edited is amended for the original PDF by
[ADR-058](058-edit-the-candidates-own-pdf-in-place.md); this redraw stays the fallback.

## Context

A generated resume was a plain-text PDF: one standard font, fixed spacing and 88-character wrapping,
whatever the candidate's own resume looked like. The PDF parser also stored each physical line as its
own block, so a bullet that wrapped onto a second line became a bullet plus a stray line. Reordering
or trimming bullets could therefore separate a bullet from the rest of its sentence. The owner asked
for the opposite: the tailored PDF must look like the candidate's own resume, with only the choice and
order of the candidate's own bullets changed ([ADR-050](050-generate-then-apply-flow.md) keeps the
rule that nothing is added or reworded).

## Decisions

1. **The parser records how each PDF line looked.** For a text PDF it keeps, beside each block, the
   baseline, and for every run its left edge, width, size, bold/italic/serif/mono traits (from the font
   name), fill color, and the thin horizontal bars (rules and underlines) that belong to the line, plus
   the page size. The data is positions and traits; run text repeats the block's own words. It is
   all-or-nothing per document, bounded (700 lines, 600 KB), strictly validated, and travels with the
   normalized document (`resume-document.schema.json`, additive optional `layout` and `page`).
2. **A bullet keeps its wrapped lines.** With layout, lines that continue a bullet (hanging indent, or
   wrapped at the marker after a line that ran to the margin without ending its sentence) join the
   bullet's node, so tailoring moves or drops whole bullets. Sections that mix lines and bullets keep
   their source order, and a singular "Project" heading and a bullet glyph touching its text are
   recognized.
3. **The tailored copy redraws the source lines.** Each kept line keeps its runs, sizes, left edge,
   colors, rules and the spacing it had after the line before it; dropped lines close up and moved
   bullets take the spacing of the place they fill; a page break follows if the content no longer
   fits. Only the standard PDF fonts are used (nearest family and style), each run stretched
   horizontally to its source width within 70-130%, so the original line breaks hold. Characters
   outside Windows-1252 are still refused rather than substituted. The original file is never edited
   or copied: no source bytes, images, links, scripts or metadata reach the new PDF.
4. **Fallback is the previous plain rendering** for DOCX, documents parsed before this change, pages
   that are rotated, and text that does not read top to bottom (columns whose reading order jumps
   back up the page). A page that mixes columns row by row (name left, contact right) is reproduced.
5. **Verification compares characters, not spacing.** The rendered PDF is re-parsed by the hardened
   parser and its characters must equal the intended blocks in order; where one run ends and the next
   begins PDF.js may or may not report a space, so spacing is ignored. The content hash that binds a
   packet is unchanged: it covers block kind and text only.

## Consequences

- Typefaces are approximated (Helvetica, Times or Courier), not the candidate's fonts, which cannot be
  reused. Weight that the exporting program only simulates (some Word exports) is lost, images and
  link annotations are dropped, and a resume the parser cannot lay out is drawn plain.
- Existing uploads carry no layout and are drawn plain until the resume is uploaded again.
- Release order: parser (new normalized object per parser version), then a governed native image
  (renderer, AST, source validator accepting the new keys). A new parser version writes a new
  normalized object key; no existing object is rewritten.
- Data classification is unchanged: layout is derived from the same confidential document, stays in
  the Documents object-store boundary and the memory-only native process, and is cleared with the
  held resume.
- Evidence is local only: unit tests plus renders of owner-supplied resumes in Chrome (see
  [evidence](../product/delivery/evidence/d3-style-preserving-resume-2026-10-21.md)).
