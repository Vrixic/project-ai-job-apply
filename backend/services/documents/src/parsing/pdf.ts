import CSSMatrix from "@thednp/dommatrix";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api.js";
import { canonicalizeLeadingBullet } from "../leading-bullet.js";
import { type BlockLayout, LAYOUT_LIMITS, type PageGeometry } from "./layout.js";
import { DOCUMENT_LIMITS, InvalidDocumentError, ParseLimitError } from "./limits.js";
import type { ParsedTextBlock } from "./normalize.js";
import {
  layoutPdfPage,
  type PdfFontTraits,
  type PdfTextItem,
  pageGeometryOf,
} from "./pdf-layout.js";

export interface ParsedPdf {
  blocks: ParsedTextBlock[];
  /** Present only when every line of every page was laid out. */
  page?: PageGeometry;
}

const squash = (value: string) => value.replace(/\s+/gu, "");

/** Equal text apart from spacing and the standard-bullet rewrite the normalizer applies. */
const same = (left: string, right: string) =>
  squash(canonicalizeLeadingBullet(left.trim())) ===
  squash(canonicalizeLeadingBullet(right.trim()));

/** Font facts PDF.js keeps once a page's operators have been read. */
function fontTraitsOf(page: PDFPageProxy, fontName: string): PdfFontTraits | undefined {
  try {
    if (!page.commonObjs.has(fontName)) return undefined;
    const font = page.commonObjs.get(fontName) as {
      name?: unknown;
      bold?: unknown;
      italic?: unknown;
      isSerifFont?: unknown;
      isMonospace?: unknown;
    };
    return {
      name: typeof font.name === "string" ? font.name : undefined,
      bold: font.bold === true,
      italic: font.italic === true,
      serif: font.isSerifFont === true,
      mono: font.isMonospace === true,
    };
  } catch {
    return undefined;
  }
}

/**
 * The look of each text line of one page, matched to the paragraphs the text path produced. Any
 * disagreement between the two, or an operator list that cannot be read, means no layout for the
 * document rather than a wrong one.
 */
async function layoutPage(
  page: PDFPageProxy,
  groups: PdfTextItem[][],
  paragraphs: readonly string[],
  ops: Readonly<Record<string, number>>,
): Promise<Array<BlockLayout | undefined> | undefined> {
  try {
    const operators = await page.getOperatorList();
    const result = layoutPdfPage({
      view: page.view as [number, number, number, number],
      rotate: page.rotate,
      groups,
      fontTraits: (fontName) => fontTraitsOf(page, fontName),
      operators,
      ops,
    });
    if (!result) return undefined;
    const texts = paragraphs.filter((paragraph) => paragraph.trim() !== "");
    const described = result.blocks.flatMap((block, index) =>
      groups[index]?.some((item) => item.str.trim() !== "") ? [{ block, index }] : [],
    );
    if (texts.length !== described.length) return undefined;
    const layouts: Array<BlockLayout | undefined> = [];
    for (const [position, { block, index }] of described.entries()) {
      const expected = texts[position] ?? "";
      const drawn = block?.runs.map((run) => run.text).join(" ") ?? "";
      const source = groups[index]?.map((item) => item.str).join(" ") ?? "";
      if (!block || same(drawn, source) === false || same(source, expected) === false)
        return undefined;
      layouts.push(block);
    }
    return layouts;
  } catch {
    return undefined;
  }
}

const forbiddenPdfTokens = [
  "/Encrypt",
  "/JavaScript",
  "/JS",
  "/Launch",
  "/EmbeddedFile",
  "/XFA",
] as const;

function decodePdfNameEscapes(source: string): string {
  return source.replace(/#([0-9a-fA-F]{2})/gu, (_match, value: string) =>
    String.fromCharCode(Number.parseInt(value, 16)),
  );
}

function containsUnsafeAnnotation(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const annotation = value as Record<string, unknown>;
  return ["action", "attachment", "file", "jsActions"].some(
    (key) => annotation[key] !== undefined && annotation[key] !== null,
  );
}

export async function parsePdf(bytes: Uint8Array): Promise<ParsedTextBlock[]> {
  return (await parsePdfWithLayout(bytes)).blocks;
}

export async function parsePdfWithLayout(bytes: Uint8Array): Promise<ParsedPdf> {
  const prefix = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 8)));
  const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
  if (!prefix.startsWith("%PDF-") || !tail.includes("%%EOF")) {
    throw new InvalidDocumentError("PDF_MAGIC_OR_EOF");
  }
  const source = decodePdfNameEscapes(new TextDecoder("latin1").decode(bytes));
  if (forbiddenPdfTokens.some((token) => source.includes(token))) {
    throw new InvalidDocumentError("PDF_ACTIVE_OR_ENCRYPTED_CONTENT");
  }

  let document: PDFDocumentProxy;
  let destroy: (() => Promise<void>) | undefined;
  try {
    if (!("DOMMatrix" in globalThis)) {
      Object.defineProperty(globalThis, "DOMMatrix", {
        value: CSSMatrix,
        configurable: true,
        writable: true,
      });
    }
    const workerGlobal = globalThis as typeof globalThis & {
      pdfjsWorker?: { WorkerMessageHandler?: unknown };
    };
    if (!workerGlobal.pdfjsWorker?.WorkerMessageHandler) {
      const { WorkerMessageHandler } = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      Object.defineProperty(workerGlobal, "pdfjsWorker", {
        value: { WorkerMessageHandler },
        configurable: true,
        writable: true,
      });
    }
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = getDocument({
      data: bytes,
      // Document diagnostics can contain source-derived names/content. Keep the existing
      // stable reason-code boundary; never emit pdfjs per-document warnings or traces.
      verbosity: 0,
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      useWasm: false,
      stopAtErrors: true,
      fontExtraProperties: true,
      maxImageSize: 1,
      enableXfa: false,
      isEvalSupported: false,
    } as Parameters<typeof getDocument>[0] & { isEvalSupported: false });
    document = await loadingTask.promise;
    destroy = () => loadingTask.destroy();
  } catch {
    throw new InvalidDocumentError("PDF_PARSE_REJECTED");
  }
  try {
    const [attachments, jsActions, hasJsActions, calculationOrder] = await Promise.all([
      document.getAttachments(),
      document.getJSActions(),
      document.hasJSActions(),
      document.getCalculationOrderIds(),
    ]);
    if (
      document.isPureXfa ||
      (attachments && attachments.size > 0) ||
      (jsActions && Object.keys(jsActions).length > 0) ||
      hasJsActions ||
      (calculationOrder && calculationOrder.length > 0)
    ) {
      throw new InvalidDocumentError("PDF_ACTIVE_OR_EMBEDDED_CONTENT");
    }
    if (document.numPages < 1 || document.numPages > DOCUMENT_LIMITS.pages) {
      throw new ParseLimitError("PDF_PAGE_LIMIT");
    }
    const blocks: ParsedTextBlock[] = [];
    let geometry: PageGeometry | undefined;
    let layoutOk = true;
    // Layout is optional: without PDF.js's operator codes the text is simply parsed without it.
    let ops: Record<string, number> | undefined;
    try {
      ops = (await import("pdfjs-dist/legacy/build/pdf.mjs")).OPS as unknown as Record<
        string,
        number
      >;
    } catch {
      ops = undefined;
    }
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: "any" });
      if (annotations.some(containsUnsafeAnnotation)) {
        throw new InvalidDocumentError("PDF_UNSAFE_ANNOTATION");
      }
      const content = await page.getTextContent({ includeMarkedContent: false });
      if (content.items.length > DOCUMENT_LIMITS.pdfTextItems) {
        throw new ParseLimitError("PDF_TEXT_ITEM_LIMIT");
      }
      let line = "";
      const groups: PdfTextItem[][] = [];
      let current: PdfTextItem[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += `${item.str}${item.hasEOL ? "\n" : " "}`;
        current.push(item as PdfTextItem);
        if (item.hasEOL) {
          groups.push(current);
          current = [];
        }
      }
      if (current.length > 0) groups.push(current);
      const paragraphs = line.split(/\n+/u);
      let layouts: Array<BlockLayout | undefined> | undefined;
      if (layoutOk) {
        try {
          layouts = ops ? await layoutPage(page, groups, paragraphs, ops) : undefined;
          const size = pageGeometryOf(page.view as [number, number, number, number]);
          geometry ??= size;
          if (
            !layouts ||
            Math.abs(geometry.width - size.width) > 1 ||
            Math.abs(geometry.height - size.height) > 1
          ) {
            layoutOk = false;
            layouts = undefined;
          }
        } catch {
          layoutOk = false;
          layouts = undefined;
        }
      }
      let next = 0;
      for (const paragraph of paragraphs) {
        const layout = paragraph.trim() === "" ? undefined : layouts?.[next++];
        blocks.push({ text: paragraph, page: pageNumber, ...(layout ? { layout } : {}) });
      }
    }
    if (
      !layoutOk ||
      !geometry ||
      blocks.filter((block) => block.layout).length > LAYOUT_LIMITS.blocks
    ) {
      for (const block of blocks) delete block.layout;
      return { blocks };
    }
    return { blocks, page: geometry };
  } finally {
    await destroy?.();
  }
}
