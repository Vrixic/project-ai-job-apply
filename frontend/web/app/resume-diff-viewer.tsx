"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { extractTextLines } from "../lib/pdf-text-lines";
import { loadPdfJs } from "../lib/pdfjs-loader";
import {
  type DiffLine,
  diffResumeLines,
  type OriginalStatus,
  type ResumeDiff,
  type TailoredStatus,
  type TextLine,
} from "../lib/resume-diff";

const MAXIMUM_PAGES = 4;
const MAXIMUM_PIXEL_RATIO = 2;

type PdfDocument = Awaited<
  ReturnType<Awaited<ReturnType<typeof loadPdfJs>>["getDocument"]>["promise"]
>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

type Side = "original" | "tailored";
type Status = OriginalStatus | TailoredStatus;

const STATUS_LABEL: Readonly<Record<Status, string>> = {
  kept: "Kept",
  moved: "Moved",
  changed: "Changed",
  removed: "Removed",
  added: "Added",
};

type Loaded =
  | { phase: "loading" }
  | { phase: "error" }
  | {
      phase: "ready";
      diff: ResumeDiff;
      originalPages: PdfPage[];
      tailoredPages: PdfPage[];
    };

/** One page drawn on a canvas with a box over every line that is not simply kept. */
function ComparedPage({
  page,
  pageNumber,
  width,
  lines,
  side,
}: {
  page: PdfPage;
  pageNumber: number;
  width: number;
  lines: ReadonlyArray<DiffLine<Status>>;
  side: Side;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const natural = page.getViewport({ scale: 1 });
  const scale = width / natural.width;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.setAttribute("aria-hidden", "true");
    let cancelled = false;
    const ratio = Math.min(window.devicePixelRatio || 1, MAXIMUM_PIXEL_RATIO);
    const viewport = page.getViewport({ scale: scale * ratio });
    element.width = Math.ceil(viewport.width);
    element.height = Math.ceil(viewport.height);
    const task = page.render({ canvas: element, viewport });
    void task.promise.catch(() => {
      if (!cancelled) element.removeAttribute("data-drawn");
    });
    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [page, scale]);

  return (
    <div className="resume-diff-page" style={{ width, height: natural.height * scale }}>
      <canvas ref={canvas} className="resume-diff-canvas" />
      {lines
        .filter((entry) => entry.line.page === pageNumber && entry.status !== "kept")
        .map((entry, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a stable list drawn once per comparison.
            key={`${side}-${index}`}
            className="resume-diff-box"
            data-status={entry.status}
            aria-hidden="true"
            style={{
              left: entry.line.x * scale - 2,
              top: entry.line.top * scale - 1,
              width: entry.line.width * scale + 4,
              height: entry.line.height * scale + 2,
            }}
          />
        ))}
    </div>
  );
}

function linesOf(entries: ReadonlyArray<DiffLine<Status>>, status: Status): TextLine[] {
  return entries.filter((entry) => entry.status === status).map((entry) => entry.line);
}

/**
 * Side by side view of the candidate's own resume and the tailored one, with every line that was
 * removed, moved, changed or added marked, plus the same facts as text so nothing depends on colour.
 * Both files are read in this page only; nothing leaves the browser and the buffers are cleared when the
 * view goes away.
 */
export function ResumeDiffViewer({
  originalBytes,
  tailoredBytes,
  onClose,
}: {
  originalBytes: Uint8Array;
  tailoredBytes: Uint8Array;
  onClose(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Loaded>({ phase: "loading" });
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(Math.floor(element.clientWidth / 2) - 24, 200));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const originalCopy = Uint8Array.from(originalBytes);
    const tailoredCopy = Uint8Array.from(tailoredBytes);
    const destroyers: Array<() => Promise<void>> = [];
    setLoaded({ phase: "loading" });
    void (async () => {
      try {
        const library = await loadPdfJs();
        const open = async (data: Uint8Array) => {
          const task = library.getDocument({ data, enableXfa: false, verbosity: 0 });
          destroyers.push(() => task.destroy());
          const document = await task.promise;
          if (document.numPages < 1 || document.numPages > MAXIMUM_PAGES) throw Error("PdfPages");
          const pages: PdfPage[] = [];
          for (let number = 1; number <= document.numPages; number += 1)
            pages.push(await document.getPage(number));
          return { document, pages };
        };
        const [original, tailored] = [await open(originalCopy), await open(tailoredCopy)];
        const diff = diffResumeLines(
          await extractTextLines(original.document),
          await extractTextLines(tailored.document),
        );
        if (cancelled) return;
        setLoaded({
          phase: "ready",
          diff,
          originalPages: original.pages,
          tailoredPages: tailored.pages,
        });
      } catch {
        if (!cancelled) setLoaded({ phase: "error" });
      }
    })();
    return () => {
      cancelled = true;
      setLoaded({ phase: "loading" });
      void Promise.allSettled(destroyers.map((destroy) => destroy())).finally(() => {
        // PDF.js takes a buffer over when it loads, so only an untaken copy still needs clearing.
        if (originalCopy.byteLength) originalCopy.fill(0);
        if (tailoredCopy.byteLength) tailoredCopy.fill(0);
      });
    };
  }, [originalBytes, tailoredBytes]);

  const diff = loaded.phase === "ready" ? loaded.diff : undefined;
  const changes = diff
    ? {
        removed: linesOf(diff.original, "removed"),
        added: linesOf(diff.tailored, "added"),
        moved: linesOf(diff.tailored, "moved"),
        changed: diff.tailored.filter((entry) => entry.status === "changed"),
      }
    : undefined;
  const unchanged =
    diff !== undefined &&
    diff.counts.removed + diff.counts.added + diff.counts.changed + diff.counts.moved === 0;

  return (
    <section className="resume-diff" aria-labelledby="resume-diff-title">
      <div className="resume-diff-head">
        <h3 id="resume-diff-title">What changed in your resume</h3>
        <button type="button" onClick={onClose}>
          Hide comparison
        </button>
      </div>
      {loaded.phase === "loading" ? <p role="status">Comparing your resumes...</p> : null}
      {loaded.phase === "error" ? (
        <p role="alert">
          The two resumes could not be compared here. You can still download the tailored one.
        </p>
      ) : null}
      {diff && changes ? (
        <>
          <p className="resume-diff-summary" role="status">
            {unchanged
              ? "No line was removed, moved, changed or added."
              : `${diff.counts.removed} removed, ${diff.counts.moved} moved, ${diff.counts.changed} changed, ${diff.counts.added} added. ${diff.counts.kept} lines kept as they were.`}
          </p>
          <ul className="resume-diff-legend" aria-label="Legend">
            {(["removed", "moved", "changed", "added"] as const).map((status) => (
              <li key={status}>
                <span className="resume-diff-swatch" data-status={status} aria-hidden="true" />
                {STATUS_LABEL[status]}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div ref={host} className="resume-diff-columns">
        {loaded.phase === "ready" && width > 0 ? (
          <>
            <figure className="resume-diff-column">
              <figcaption>Your original</figcaption>
              {loaded.originalPages.map((page, index) => (
                <ComparedPage
                  // biome-ignore lint/suspicious/noArrayIndexKey: pages are a fixed ordered list.
                  key={index}
                  page={page}
                  pageNumber={index + 1}
                  width={width}
                  lines={loaded.diff.original}
                  side="original"
                />
              ))}
            </figure>
            <figure className="resume-diff-column">
              <figcaption>Tailored for this job</figcaption>
              {loaded.tailoredPages.map((page, index) => (
                <ComparedPage
                  // biome-ignore lint/suspicious/noArrayIndexKey: pages are a fixed ordered list.
                  key={index}
                  page={page}
                  pageNumber={index + 1}
                  width={width}
                  lines={loaded.diff.tailored}
                  side="tailored"
                />
              ))}
            </figure>
          </>
        ) : null}
      </div>
      {changes && !unchanged ? (
        <div className="resume-diff-lists">
          {changes.removed.length > 0 ? (
            <details open>
              <summary>Removed ({changes.removed.length})</summary>
              <ul>
                {changes.removed.map((line, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a stable list drawn once.
                  <li key={index} className="resume-diff-removed">
                    {line.text}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {changes.changed.length > 0 ? (
            <details open>
              <summary>Changed ({changes.changed.length})</summary>
              <ul>
                {changes.changed.map((entry, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a stable list drawn once.
                  <li key={index}>
                    {(entry.words ?? []).map((word, position) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: words keep their order.
                      <Fragment key={position}>
                        {word.kind === "added" ? (
                          <ins>{word.text}</ins>
                        ) : word.kind === "removed" ? (
                          <del>{word.text}</del>
                        ) : (
                          word.text
                        )}{" "}
                      </Fragment>
                    ))}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {changes.added.length > 0 ? (
            <details open>
              <summary>Added ({changes.added.length})</summary>
              <ul>
                {changes.added.map((line, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a stable list drawn once.
                  <li key={index} className="resume-diff-added">
                    {line.text}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {changes.moved.length > 0 ? (
            <details>
              <summary>Moved ({changes.moved.length})</summary>
              <ul>
                {changes.moved.map((line, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a stable list drawn once.
                  <li key={index}>{line.text}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
