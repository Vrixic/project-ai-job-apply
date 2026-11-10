"use client";

import { useEffect, useRef } from "react";
import { loadPdfJs } from "../lib/pdfjs-loader";

const MAXIMUM_PAGES = 4;
const MAXIMUM_PIXEL_RATIO = 2;

/**
 * Shows the exact PDF the candidate will download, drawn page by page. The bytes are never given a
 * URL: they go straight from memory into PDF.js, which works on its own copy that is cleared when
 * the viewer goes away. Scripts, forms and links inside the file are not run or shown.
 */
export function ResumePdfViewer({
  bytes,
  label,
  onRendered,
  onFailed,
}: {
  bytes: Uint8Array;
  label: string;
  onRendered(): void;
  onFailed(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onRendered, onFailed });
  callbacks.current = { onRendered, onFailed };

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    const copy = Uint8Array.from(bytes);
    let destroy: (() => Promise<void>) | undefined;
    void (async () => {
      try {
        const library = await loadPdfJs();
        const task = library.getDocument({
          data: copy,
          enableXfa: false,
          verbosity: 0,
        });
        destroy = () => task.destroy();
        const document = await task.promise;
        if (cancelled) return;
        if (document.numPages < 1 || document.numPages > MAXIMUM_PAGES) throw Error("PdfPages");
        const width = element.clientWidth || 640;
        const ratio = Math.min(window.devicePixelRatio || 1, MAXIMUM_PIXEL_RATIO);
        const canvases: HTMLCanvasElement[] = [];
        for (let number = 1; number <= document.numPages; number += 1) {
          const page = await document.getPage(number);
          const natural = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / natural.width) * ratio });
          const canvas = window.document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.className = "resume-pdf-page";
          canvas.setAttribute("aria-hidden", "true");
          await page.render({ canvas, viewport }).promise;
          if (cancelled) return;
          canvases.push(canvas);
        }
        element.replaceChildren(...canvases);
        callbacks.current.onRendered();
      } catch {
        if (!cancelled) callbacks.current.onFailed();
      }
    })();
    return () => {
      cancelled = true;
      element.replaceChildren();
      void (destroy?.() ?? Promise.resolve()).finally(() => {
        // PDF.js takes the buffer over when it loads, so only an untaken copy still needs clearing.
        if (copy.byteLength) copy.fill(0);
      });
    };
  }, [bytes]);

  return <div ref={host} className="resume-pdf" role="img" aria-label={label} />;
}
