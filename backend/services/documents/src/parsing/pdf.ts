import CSSMatrix from "@thednp/dommatrix";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api.js";
import { DOCUMENT_LIMITS, InvalidDocumentError, ParseLimitError } from "./limits.js";
import type { ParsedTextBlock } from "./normalize.js";

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
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      useWasm: false,
      stopAtErrors: true,
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
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += `${item.str}${item.hasEOL ? "\n" : " "}`;
      }
      for (const paragraph of line.split(/\n+/u)) {
        blocks.push({ text: paragraph, page: pageNumber });
      }
    }
    return blocks;
  } finally {
    await destroy?.();
  }
}
