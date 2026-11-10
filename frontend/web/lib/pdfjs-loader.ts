type PdfJs = typeof import("pdfjs-dist");

let pdfjs: Promise<PdfJs> | undefined;

/**
 * PDF.js runs on the page's own thread, so no worker file, blob URL or plugin is needed and the
 * document stays within the existing content security policy (`object-src 'none'`). It is loaded only
 * when a resume is shown.
 */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= (async () => {
    const [library, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.mjs"),
    ]);
    Object.defineProperty(globalThis, "pdfjsWorker", {
      value: { WorkerMessageHandler: worker.WorkerMessageHandler },
      configurable: true,
      writable: true,
    });
    return library;
  })().catch((error: unknown) => {
    pdfjs = undefined;
    throw error;
  });
  return pdfjs;
}
