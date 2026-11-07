import { inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
} from "pdf-lib";
import type { PageGeometry } from "../../parsing/layout.js";
import type { AstLine } from "../../resume-ast/types.js";
import type { RenderBlock } from "../../tailoring/tailor.js";
import { digest, type RenderedDocument } from "../pdf-text.js";
import { CONTENT_LIMITS, nameOf, operations, tokenize } from "./content-stream.js";
import { OriginalEditUnsupported } from "./errors.js";
import { type PageUnits, pageUnits, type Rect } from "./page-units.js";
import { planEdits } from "./plan.js";

const MAX_PAGES = 10;
const MAX_OUTPUT_BYTES = 1_500_000;
const MAX_LINKS_PER_PAGE = 60;
const MOVE_EPSILON = 0.01;
const LINK_SCHEME = /^(?:https?:\/\/|mailto:)[\x21-\x7e]{1,2000}$/u;

/** Keys that can make a viewer act, load something, or carry data that is not on the page. */
const DENIED_KEYS = [
  "JS",
  "JavaScript",
  "AA",
  "OpenAction",
  "Launch",
  "EmbeddedFile",
  "EmbeddedFiles",
  "AF",
  "RichMedia",
  "XFA",
  "SubmitForm",
  "ImportData",
  "GoToR",
  "GoToE",
  "Movie",
  "Sound",
  "Rendition",
  "Metadata",
  "PieceInfo",
  "Thumb",
  "StructParents",
  "StructParent",
  "OC",
];
const ALLOWED_RESOURCES = new Set(["Font", "XObject", "ExtGState", "ColorSpace", "ProcSet"]);
const ALLOWED_FONT_SUBTYPES = new Set([
  "Type1",
  "TrueType",
  "Type0",
  "CIDFontType0",
  "CIDFontType2",
]);
const PAGE_KEYS_REMOVED = [
  "Annots",
  "AA",
  "Metadata",
  "PieceInfo",
  "Thumb",
  "StructParents",
  "B",
  "Dur",
  "Trans",
  "ID",
  "VP",
  "LastModified",
  "SeparationInfo",
  "UserUnit",
];

function filterNames(stream: PDFStream): string[] {
  const filter = stream.dict.lookup(PDFName.of("Filter"));
  if (filter === undefined) return [];
  if (filter instanceof PDFName) return [filter.asString()];
  if (filter instanceof PDFArray)
    return filter.asArray().map((item) => (item instanceof PDFName ? item.asString() : "?"));
  return ["?"];
}

function streamBytes(stream: PDFStream): Uint8Array {
  if (!(stream instanceof PDFRawStream))
    throw new OriginalEditUnsupported("UNSUPPORTED_CONTENT_FILTER");
  const names = filterNames(stream).map((name) => (name === "/FlateDecode" ? "FlateDecode" : name));
  if (names.length === 0) return stream.contents;
  const only = names[0];
  if (names.length !== 1 || (only !== "FlateDecode" && only !== "Fl"))
    throw new OriginalEditUnsupported("UNSUPPORTED_CONTENT_FILTER");
  if (stream.dict.has(PDFName.of("DecodeParms")))
    throw new OriginalEditUnsupported("UNSUPPORTED_CONTENT_FILTER");
  try {
    return inflateSync(stream.contents, { maxOutputLength: CONTENT_LIMITS.bytes });
  } catch {
    throw new OriginalEditUnsupported("CONTENT_TOO_LARGE");
  }
}

function pageContent(doc: PDFDocument, contents: PDFObject | undefined): Uint8Array {
  const parts: Uint8Array[] = [];
  const add = (value: PDFObject | undefined) => {
    const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value;
    if (resolved instanceof PDFStream) parts.push(streamBytes(resolved));
    else throw new OriginalEditUnsupported("CONTENT_MALFORMED");
  };
  if (contents instanceof PDFArray) for (const item of contents.asArray()) add(item);
  else add(contents);
  let total = 0;
  for (const part of parts) total += part.byteLength + 1;
  if (total > CONTENT_LIMITS.bytes) throw new OriginalEditUnsupported("CONTENT_TOO_LARGE");
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
    joined[offset] = 10;
    offset += 1;
  }
  return joined;
}

function numberAt(array: PDFArray, index: number): number {
  const value = array.lookup(index);
  if (!(value instanceof PDFNumber)) throw new OriginalEditUnsupported("ROTATED_OR_OFFSET_PAGE");
  return value.asNumber();
}

function checkPageBox(doc: PDFDocument, pageIndex: number, page: PageGeometry): void {
  const node = doc.getPage(pageIndex).node;
  const box = node.MediaBox();
  const rotate = node.lookupMaybe(PDFName.of("Rotate"), PDFNumber);
  const crop = node.lookupMaybe(PDFName.of("CropBox"), PDFArray);
  if (!box || (rotate && rotate.asNumber() % 360 !== 0))
    throw new OriginalEditUnsupported("ROTATED_OR_OFFSET_PAGE");
  const [x0, y0, x1, y1] = [0, 1, 2, 3].map((index) => numberAt(box, index)) as [
    number,
    number,
    number,
    number,
  ];
  if (
    Math.abs(x0) > 0.5 ||
    Math.abs(y0) > 0.5 ||
    Math.abs(x1 - page.width) > 0.5 ||
    Math.abs(y1 - page.height) > 0.5
  )
    throw new OriginalEditUnsupported("ROTATED_OR_OFFSET_PAGE");
  if (crop) {
    const [c0, c1, c2, c3] = [0, 1, 2, 3].map((index) => numberAt(crop, index)) as [
      number,
      number,
      number,
      number,
    ];
    if (
      Math.abs(c0) > 0.5 ||
      Math.abs(c1) > 0.5 ||
      Math.abs(c2 - x1) > 0.5 ||
      Math.abs(c3 - y1) > 0.5
    )
      throw new OriginalEditUnsupported("ROTATED_OR_OFFSET_PAGE");
  }
}

interface SourceLink {
  rect: Rect;
  uri: string;
}

function linksOf(doc: PDFDocument, pageIndex: number): SourceLink[] {
  const annots = doc.getPage(pageIndex).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return [];
  const links: SourceLink[] = [];
  for (const item of annots.asArray()) {
    const annotation = doc.context.lookupMaybe(item, PDFDict);
    if (!annotation) continue;
    const subtype = annotation.lookup(PDFName.of("Subtype"));
    if (!(subtype instanceof PDFName) || subtype.asString() !== "/Link") continue;
    const action = annotation.lookupMaybe(PDFName.of("A"), PDFDict);
    const kind = action?.lookup(PDFName.of("S"));
    const target = action?.lookup(PDFName.of("URI"));
    const rect = annotation.lookupMaybe(PDFName.of("Rect"), PDFArray);
    if (!(kind instanceof PDFName) || kind.asString() !== "/URI" || !rect || rect.size() !== 4)
      continue;
    const uri =
      target instanceof PDFString
        ? target.asString()
        : target instanceof PDFHexString
          ? target.decodeText()
          : undefined;
    if (uri === undefined || !LINK_SCHEME.test(uri)) continue;
    const [a, b, c, d] = [0, 1, 2, 3].map((index) => numberAt(rect, index)) as [
      number,
      number,
      number,
      number,
    ];
    links.push({
      rect: { x0: Math.min(a, c), y0: Math.min(b, d), x1: Math.max(a, c), y1: Math.max(b, d) },
      uri,
    });
    if (links.length > MAX_LINKS_PER_PAGE) break;
  }
  return links;
}

function usedNames(bytes: Uint8Array, groupsText: ReadonlyArray<{ start: number; end: number }>) {
  const fonts = new Set<string>();
  const xobjects = new Set<string>();
  for (const group of groupsText) {
    const slice = bytes.subarray(group.start, group.end);
    const ops = operations(slice, tokenize(slice));
    for (const operation of ops) {
      if (operation.op === "Tf") fonts.add(nameOf(slice, operation.operands[0]));
      if (operation.op === "Do") xobjects.add(nameOf(slice, operation.operands.at(-1)));
    }
  }
  return { fonts, xobjects };
}

/** Walks everything reachable from a page and refuses anything that is not plain page content. */
function assertPlainPage(doc: PDFDocument, root: PDFObject): void {
  const seen = new Set<unknown>();
  const stack: PDFObject[] = [root];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop() as PDFObject;
    const value = current instanceof PDFRef ? doc.context.lookup(current) : current;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    visited += 1;
    if (visited > 5000) throw new OriginalEditUnsupported("UNSAFE_OBJECT");
    const dict =
      value instanceof PDFStream ? value.dict : value instanceof PDFDict ? value : undefined;
    if (dict) {
      for (const key of DENIED_KEYS)
        if (dict.has(PDFName.of(key))) throw new OriginalEditUnsupported("UNSAFE_OBJECT");
      const type = dict.lookup(PDFName.of("Type"));
      const subtype = dict.lookup(PDFName.of("Subtype"));
      if (type instanceof PDFName && type.asString() === "/Font") {
        const name = subtype instanceof PDFName ? subtype.asString().slice(1) : "";
        if (!ALLOWED_FONT_SUBTYPES.has(name))
          throw new OriginalEditUnsupported("RESOURCE_UNSUPPORTED");
      }
      if (
        value instanceof PDFStream &&
        subtype instanceof PDFName &&
        subtype.asString() === "/Form"
      )
        throw new OriginalEditUnsupported("TEXT_IN_FORM_OR_PATTERN");
      for (const [, child] of dict.entries()) stack.push(child);
    } else if (value instanceof PDFArray) {
      for (const child of value.asArray()) stack.push(child);
    }
  }
}

/**
 * Edits the candidate's own PDF in place: text blocks the tailoring left out are dropped, the rest
 * are moved up to close the gap, and everything else on the page (fonts, colors, backgrounds, icons,
 * rules, links) is exactly the original. The result is a NEW file built from only the page content,
 * the fonts and images it uses and plain link annotations: no metadata, scripts, attachments,
 * form data, outlines or other source structure is carried over.
 */
async function editOriginal(input: {
  original: Uint8Array;
  blocks: readonly RenderBlock[];
  sourceLines: readonly AstLine[];
  page: PageGeometry;
}): Promise<RenderedDocument> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(Uint8Array.from(input.original), {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
  } catch {
    throw new OriginalEditUnsupported("ENCRYPTED");
  }
  const pageCount = source.getPageCount();
  if (pageCount < 1 || pageCount > MAX_PAGES) throw new OriginalEditUnsupported("PAGE_COUNT");
  const pagesInSource = [...Array(pageCount).keys()];
  const contents: Uint8Array[] = [];
  const units: PageUnits[] = [];
  for (const index of pagesInSource) {
    checkPageBox(source, index, input.page);
    const bytes = pageContent(source, source.getPage(index).node.Contents());
    contents.push(bytes);
    units.push(pageUnits(bytes, operations(bytes, tokenize(bytes))));
  }
  const plans = planEdits({
    blocks: input.blocks,
    sourceLines: input.sourceLines,
    page: input.page,
    pages: units,
  });

  // Stage 1: copy the pages into a scratch document and rewrite their content and resources.
  const scratch = await PDFDocument.create({ updateMetadata: false });
  const copies = await scratch.copyPages(source, pagesInSource);
  // The copies belong to no page tree until they are added; stage 2 reads the scratch page tree.
  for (const copy of copies) scratch.addPage(copy);
  const keptPages: number[] = [];
  const newLinks = new Map<number, SourceLink[]>();
  copies.forEach((copy, index) => {
    const plan = plans[index];
    const unit = units[index];
    const bytes = contents[index];
    if (!plan || !unit || !bytes) throw new OriginalEditUnsupported("CONTENT_MALFORMED");
    const body: string[] = [];
    const keptGroups: Array<{ start: number; end: number }> = [];
    let anyText = false;
    // Text is written in its new reading order, into the places the page's text held, so a reader
    // that follows the file (a text extractor, an applicant tracking system) sees what the page shows.
    // Everything else keeps its place, so nothing is painted over anything it was not before.
    const kept = unit.groups.flatMap((_group, at) => (plan.keep[at] ? [at] : []));
    const textSlots = kept.filter((at) => plan.order[at] !== undefined);
    const inReadingOrder = [...textSlots].sort(
      (a, b) => (plan.order[a] as number) - (plan.order[b] as number) || a - b,
    );
    const takes = new Map(
      textSlots.map((at, position) => [at, inReadingOrder[position] as number]),
    );
    for (const slot of kept) {
      const groupIndex = takes.get(slot) ?? slot;
      const group = unit.groups[groupIndex];
      if (!group) throw new OriginalEditUnsupported("CONTENT_MALFORMED");
      const text = Buffer.from(bytes.subarray(group.start, group.end)).toString("latin1");
      const info = unit.info[groupIndex];
      if (info && info.texts.length > 0) anyText = true;
      keptGroups.push(group);
      const move = plan.move[groupIndex] ?? 0;
      body.push(
        Math.abs(move) > MOVE_EPSILON ? `q 1 0 0 1 0 ${move.toFixed(4)} cm\n${text}\nQ` : text,
      );
    }
    if (!anyText) return; // a page left with no text at all is dropped
    keptPages.push(index);
    const out = Buffer.from(body.join("\n"), "latin1");
    if (out.byteLength > CONTENT_LIMITS.bytes)
      throw new OriginalEditUnsupported("CONTENT_TOO_LARGE");
    for (const key of PAGE_KEYS_REMOVED) copy.node.delete(PDFName.of(key));
    copy.node.set(
      PDFName.of("Contents"),
      scratch.context.register(scratch.context.flateStream(out)),
    );

    // Keep only the fonts and images this page's kept blocks draw with.
    const resources = copy.node.Resources();
    if (!resources) throw new OriginalEditUnsupported("RESOURCE_UNSUPPORTED");
    for (const key of resources.keys()) {
      if (!ALLOWED_RESOURCES.has(key.asString().slice(1)))
        throw new OriginalEditUnsupported("RESOURCE_UNSUPPORTED");
    }
    const used = usedNames(bytes, keptGroups);
    for (const [category, names] of [
      ["Font", used.fonts],
      ["XObject", used.xobjects],
    ] as const) {
      const dict = resources.lookupMaybe(PDFName.of(category), PDFDict);
      if (!dict) continue;
      for (const key of dict.keys()) if (!names.has(key.asString())) dict.delete(key);
    }

    const rebuilt: SourceLink[] = [];
    for (const link of linksOf(source, index)) {
      const owner = plan.ownerOf(link.rect);
      if (!owner?.kept) continue;
      rebuilt.push({
        uri: link.uri,
        rect: {
          x0: link.rect.x0,
          x1: link.rect.x1,
          y0: link.rect.y0 + owner.move,
          y1: link.rect.y1 + owner.move,
        },
      });
    }
    newLinks.set(index, rebuilt);
  });
  if (keptPages.length === 0) throw new OriginalEditUnsupported("PAGE_COUNT");

  // Stage 2: copy only what the rewritten pages still reach into a clean document.
  const output = await PDFDocument.create({ updateMetadata: false });
  const clean = await output.copyPages(
    scratch,
    keptPages.map((index) => index),
  );
  clean.forEach((pageCopy, position) => {
    assertPlainPage(output, pageCopy.node);
    const links = newLinks.get(keptPages[position] as number) ?? [];
    if (links.length > 0) {
      const annotations = links.map((link) =>
        output.context.register(
          output.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [link.rect.x0, link.rect.y0, link.rect.x1, link.rect.y1],
            Border: [0, 0, 0],
            F: 4,
            A: { Type: "Action", S: "URI", URI: PDFString.of(link.uri) },
          }),
        ),
      );
      pageCopy.node.set(PDFName.of("Annots"), output.context.obj(annotations));
    }
    output.addPage(pageCopy);
  });
  const bytes = await output.save({ useObjectStreams: false });
  if (bytes.byteLength > MAX_OUTPUT_BYTES) throw new OriginalEditUnsupported("OUTPUT_TOO_LARGE");
  const final = Uint8Array.from(bytes);
  return {
    mediaType: "application/pdf",
    bytes: final,
    sha256: digest(final),
    pageCount: keptPages.length,
  };
}

/**
 * The only thing this ever throws is {@link OriginalEditUnsupported}: a hostile or unexpected file
 * must end in the caller's fallback, never in an error that carries the file's content.
 */
export async function editOriginalPdf(input: {
  original: Uint8Array;
  blocks: readonly RenderBlock[];
  sourceLines: readonly AstLine[];
  page: PageGeometry;
}): Promise<RenderedDocument> {
  try {
    return await editOriginal(input);
  } catch (error) {
    if (error instanceof OriginalEditUnsupported) throw error;
    throw new OriginalEditUnsupported("CONTENT_MALFORMED");
  }
}
