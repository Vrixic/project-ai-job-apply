# ADR-058: Edit the candidate's own PDF in place

Status: Proposed (owner-directed 2026-11-07); code merged dark (#810), source-read IAM entry approved by
the owner 2026-11-07 and written as a flagged Terraform change, governed release and live acceptance pending
Date: 2026-11-07

Amends [ADR-051](051-style-preserving-generated-resume.md) decision 3 ("the original file is never
edited or copied") for the original PDF only.

## Context

[ADR-051](051-style-preserving-generated-resume.md) redraws the tailored resume with the standard
PDF fonts. Compared with the owner's own resume it loses the typeface (Calibri becomes Arial),
bold labels that Word simulates, square bullet glyphs, icons, images, sidebars, link annotations and
exact spacing, and a resume with columns or a sidebar falls back to plain text. On 2026-11-07 the
owner asked for the opposite: the generated PDF must never change the aesthetics of the candidate's
own PDF; only the values change, to cater the resume to the job. [ADR-050](050-generate-then-apply-flow.md)
still holds: tailoring keeps, moves or omits the candidate's own lines and adds nothing.

## Decisions

1. **The candidate's own PDF is the page.** When the original PDF is at hand and was written one
   `q ... Q` block per piece of text (Word, Google Docs, LibreOffice and Pages exports), the page's
   content stream is edited, not redrawn. A block of text for a line the tailoring left out is
   dropped; a kept line moves by a translation (`1 0 0 1 0 dy cm`) to the baseline it now has; the
   text is written in the new reading order so a reader that follows the file (a text extractor, an
   applicant tracking system) sees what the page shows. Rules, underlines and icons belong to the line
   whose band they sit in and move or go with it; a rule between lines keeps its distance from the
   nearest kept line above it; backgrounds, sidebars and any large graphic stay where they are. Fonts,
   colors, images, spacing and bullets are therefore the candidate's own, byte for byte.
2. **A new file, built from a whitelist.** The result is written by `pdf-lib` as a NEW document from
   only what the rewritten pages reach: content, `Font`, `XObject`, `ExtGState`, `ColorSpace` and
   `ProcSet` resources, and link annotations rebuilt from scratch for `http`, `https` and `mailto`
   addresses (moved with their line, dropped with it). Metadata, outlines, forms, scripts and
   actions, embedded files, the structure tree, thumbnails and every other page key are not carried
   over. A Form XObject, pattern, Type 3 font or any key on the deny list stops the edit.
3. **Anything unusual falls back, never fails.** The editor throws one error type. Unsupported means
   a content filter other than Flate, text in a Form XObject or pattern, text moves the editor does not
   follow (`Td`, `T*`), rotation, a crop box that is not the media box, a line that cannot be matched
   to exactly one source line, a graphic that cannot be placed, an edit that needs text on another
   page, an output over 300 KB (the API's resume file ceiling) or more than 10 pages. The fallback
   order is original-edit, then the ADR-051 redraw, then plain text. The reported method is only a
   word (`original_page`, `styled`, `plain`).
4. **Verified like every other rendering.** The edited file is re-parsed by the hardened parser and
   its characters must equal the intended blocks, in order, before it is used; a mismatch uses the
   next fallback. The content hash that binds a packet is unchanged.
5. **Bounded hostile input.** The content stream is read with a bounded inflate (3 MB, 600,000
   tokens, 200,000 operations, nesting 32, 6,000 operands per operation) and a tokenizer that never
   interprets fonts or draws. The original is at most 600 KB. The editor runs only in the isolated
   native generation process with no network, SQL or object capability.
6. **The original reaches that process through the existing source RPC.** The owner-authenticated
   source RPC gains one optional field, `originalPdfBase64`, validated with the closed-key validator:
   canonical base64, at most 600 KB decoded, `%PDF-` header, and its SHA-256 must equal the base
   document's recorded source hash, so it can only be the file that was parsed. A reader in the
   source Lambda applies the parser's checks (clean malware-scan tag, exact object version, KMS key,
   recorded metadata, size, digest) and leaves the field out on any doubt; generation never fails
   because the original could not be used. The reader is off unless
   `NATIVE_RESUME_ORIGINAL_PDF_ENABLED=true` is set on the source Lambda.
7. **One flow at a time.** A page whose reading order jumps back up (a sidebar or true columns) is
   not edited yet, because the parser's layout record is all-or-nothing and single-flow. A follow-up
   records reading zones in the parser (additive, parser version bump) so each zone is edited on its
   own.

## Consequences

- Candidates whose resume is a single-flow Word-style PDF get their own typography back. Sidebar and
  column designs still use the ADR-051 redraw until zones land.
- **Security-gate change, approved by the owner 2026-11-07.** The source Lambda today may read only
  `normalized/*/*/*/resume.json` and denies every other object read. Using the original needs an
  exact allow entry for `quarantine/*/source` (`s3:GetObjectVersion`, `s3:GetObjectVersionTagging`),
  the same prefix added to the `NoOtherObjectReads` deny's allow-list, and the flag above. Without it
  nothing changes. It is the module variable `original_pdf_enabled` (default off, per release in the
  development environment); with it off the policy and environment are unchanged and the owner handler
  never gains an object read.
- The original PDF, which holds the same personal data as its text plus fonts, images and metadata,
  is read once per generation, held in the memory-only native process with the resume, cleared with it,
  and never written anywhere or logged. No new data leaves the Documents boundary.
- Release order after approval: Terraform (IAM and flag), then a governed Lambda artifact and native
  image release (editor, reader, source validator, session); the parser is unchanged.
- The Lambda tailoring service keeps producing the ADR-051 redraw; it is not used when native
  preparation is on.
