"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { extractTextLines } from "../lib/pdf-text-lines";
import { loadPdfJs } from "../lib/pdfjs-loader";
import {
  type DiffLine,
  diffResumeLines,
  type OriginalStatus,
  type RemovalPoint,
  type ResumeDiff,
  removalPoints,
  type TailoredStatus,
  type TextLine,
} from "../lib/resume-diff";

const MAXIMUM_PAGES = 4;
const MAXIMUM_PIXEL_RATIO = 2;

type PdfDocument = Awaited<
  ReturnType<Awaited<ReturnType<typeof loadPdfJs>>["getDocument"]>["promise"]
>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

type Status = OriginalStatus | TailoredStatus;

/** What a box over a line says. A moved line is new where it now stands, so it is green like an added one. */
type BoxStatus = "removed" | "changed" | "added";

const BOX_LABEL: Readonly<Record<BoxStatus, string>> = {
  removed: "Removed",
  changed: "Changed",
  added: "Added or moved",
};

const boxStatusOf = (status: Status, side: "original" | "tailored"): BoxStatus | undefined => {
  if (status === "changed") return "changed";
  if (side === "original") return status === "removed" ? "removed" : undefined;
  return status === "added" || status === "moved" ? "added" : undefined;
};

interface Box {
  line: TextLine;
  status: BoxStatus;
}

const boxesOf = (entries: ReadonlyArray<DiffLine<Status>>, side: "original" | "tailored"): Box[] =>
  entries.flatMap((entry) => {
    const status = boxStatusOf(entry.status, side);
    return status ? [{ line: entry.line, status }] : [];
  });

/** Room beside the tailored page for the red tags that say what was cut and where. */
const CUT_GUTTER = 150;
const CUT_TAG_CHARACTERS = 20;

/** The first words of a removed line, with how many more were cut at the same place. */
function cutLabel(texts: readonly string[]): string {
  const first = texts[0] ?? "";
  const words =
    first.length > CUT_TAG_CHARACTERS
      ? `${first.slice(0, CUT_TAG_CHARACTERS).replace(/\s+\S*$/u, "")}...`
      : first;
  return `- ${words}${texts.length > 1 ? ` (+${texts.length - 1})` : ""}`;
}

type Loaded =
  | { phase: "loading" }
  | { phase: "error" }
  | {
      phase: "ready";
      diff: ResumeDiff;
      originalPages: PdfPage[];
      tailoredPages: PdfPage[];
    };

/**
 * One page drawn on a canvas with a box over every line that is new, changed or removed. On the tailored
 * side a red line also crosses the page at each place a line was cut, leading to a tag that says what
 * was cut.
 */
function ComparedPage({
  page,
  pageNumber,
  width,
  boxes,
  cuts = [],
  gutter = 0,
}: {
  page: PdfPage;
  pageNumber: number;
  width: number;
  boxes: ReadonlyArray<Box>;
  cuts?: ReadonlyArray<RemovalPoint>;
  /** Width of the tag column beside the page, 0 where there is none. */
  gutter?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const natural = page.getViewport({ scale: 1 });
  const scale = width / natural.width;
  const height = natural.height * scale;

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

  const drawn = (
    <div className="resume-diff-page" style={{ width, height }}>
      <canvas ref={canvas} className="resume-diff-canvas" />
      {boxes
        .filter((box) => box.line.page === pageNumber)
        .map((box, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a stable list drawn once per comparison.
            key={index}
            className="resume-diff-box"
            data-status={box.status}
            aria-hidden="true"
            style={{
              left: box.line.x * scale - 2,
              top: box.line.top * scale - 1,
              width: box.line.width * scale + 4,
              height: box.line.height * scale + 2,
            }}
          />
        ))}
    </div>
  );
  const here = cuts.filter((cut) => cut.page === pageNumber);
  if (here.length === 0 && gutter === 0) return drawn;
  return (
    <div className="resume-diff-page-wrap" style={{ width: width + gutter, height }}>
      {drawn}
      {here.map((cut, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a stable list drawn once per comparison.
          key={index}
          className="resume-diff-cut"
          aria-hidden="true"
          style={{ top: cut.top * scale, width: width + gutter }}
        >
          <span className="resume-diff-cut-line" title={`Cut here:\n${cut.texts.join("\n")}`} />
          {gutter > 0 ? (
            <span
              className="resume-diff-cut-tag"
              style={{ maxWidth: gutter - 8 }}
              title={`Cut here:\n${cut.texts.join("\n")}`}
            >
              {cutLabel(cut.texts)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function linesOf(entries: ReadonlyArray<DiffLine<Status>>, status: Status): TextLine[] {
  return entries.filter((entry) => entry.status === status).map((entry) => entry.line);
}

/** Two pages side by side from this width of the view; narrower views stack them. */
const TWO_COLUMNS_FROM_WIDTH = 760;

/**
 * Side by side view of the candidate's own resume and the tailored one. On the tailored page, green marks
 * every line that is new or in a new place and a red line with a tag marks where a line was cut; the
 * original page marks what was removed. The same facts follow as text so nothing depends on colour. Both
 * files are read in this page only; nothing leaves the browser and the buffers are cleared when the view
 * goes away. Its title and close control belong to the side panel that holds it.
 */
export function ResumeDiffViewer({
  originalBytes,
  tailoredBytes,
}: {
  originalBytes: Uint8Array;
  tailoredBytes: Uint8Array;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Loaded>({ phase: "loading" });
  const [hostWidth, setHostWidth] = useState(0);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setHostWidth(element.clientWidth);
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
        added: diff.tailored
          .filter((entry) => entry.status === "added" || entry.status === "moved")
          .map((entry) => entry.line),
        changed: diff.tailored.filter((entry) => entry.status === "changed"),
      }
    : undefined;
  const unchanged =
    diff !== undefined &&
    diff.counts.removed + diff.counts.added + diff.counts.changed + diff.counts.moved === 0;
  const cuts = diff ? removalPoints(diff) : [];
  const originalBoxes = diff ? boxesOf(diff.original, "original") : [];
  const tailoredBoxes = diff ? boxesOf(diff.tailored, "tailored") : [];
  // Two pages side by side, with room for the cut tags beside the tailored one; stacked pages have none.
  const columns = hostWidth >= TWO_COLUMNS_FROM_WIDTH ? 2 : 1;
  const gutter = columns === 2 && cuts.length > 0 ? CUT_GUTTER : 0;
  const width = Math.max(
    columns === 2 ? Math.floor((hostWidth - 48 - gutter) / 2) : hostWidth - 24,
    200,
  );

  return (
    <div className="resume-diff">
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
              ? "No line was removed, changed, added or moved."
              : `${diff.counts.removed} removed, ${diff.counts.changed} changed, ${diff.counts.added + diff.counts.moved} added or moved. ${diff.counts.kept} lines kept as they were.`}
          </p>
          <ul className="resume-diff-legend" aria-label="Legend">
            {(["removed", "changed", "added"] as const).map((status) => (
              <li key={status}>
                <span className="resume-diff-swatch" data-status={status} aria-hidden="true" />
                {BOX_LABEL[status]}
              </li>
            ))}
            {cuts.length > 0 ? (
              <li>
                <span className="resume-diff-swatch" data-status="cut" aria-hidden="true" />
                Cut from here
              </li>
            ) : null}
          </ul>
        </>
      ) : null}
      <div ref={host} className="resume-diff-columns">
        {loaded.phase === "ready" ? (
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
                  boxes={originalBoxes}
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
                  boxes={tailoredBoxes}
                  cuts={cuts}
                  gutter={gutter}
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
              <summary>Added or moved ({changes.added.length})</summary>
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
        </div>
      ) : null}
    </div>
  );
}
