// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TextLine } from "../lib/resume-diff";
import { ResumeDiffViewer } from "./resume-diff-viewer";

// PDF.js and a canvas are not available here; the viewer is given two fake documents whose text lines
// are fixed. How lines are matched is proven in lib/resume-diff.test.ts.
const documents = vi.hoisted(() => ({ original: [] as unknown[], tailored: [] as unknown[] }));

vi.mock("../lib/pdfjs-loader", () => ({
  loadPdfJs: async () => ({
    getDocument: ({ data }: { data: Uint8Array }) => {
      const lines = data[0] === 1 ? documents.original : documents.tailored;
      const page = {
        getViewport: ({ scale }: { scale: number }) => ({
          width: 612 * scale,
          height: 792 * scale,
        }),
        render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
      };
      return {
        promise: Promise.resolve({ numPages: 1, getPage: async () => page, lines }),
        destroy: async () => undefined,
      };
    },
  }),
}));
vi.mock("../lib/pdf-text-lines", () => ({
  extractTextLines: async (document: { lines: unknown[] }) => document.lines,
}));

const line = (text: string, top: number): TextLine => ({
  page: 1,
  x: 40,
  top,
  width: 300,
  height: 12,
  text,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** jsdom has no layout: `windowWidth` is how wide the view is, which decides one column or two. */
async function show(original: TextLine[], tailored: TextLine[], windowWidth = 0) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(windowWidth);
  documents.original = original;
  documents.tailored = tailored;
  await act(async () =>
    root.render(
      <ResumeDiffViewer originalBytes={Uint8Array.of(1)} tailoredBytes={Uint8Array.of(2)} />,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
}

const legend = () =>
  Array.from(container.querySelectorAll(".resume-diff-legend li")).map((item) =>
    item.textContent?.trim(),
  );
const columns = () => Array.from(container.querySelectorAll(".resume-diff-column"));
const sections = () =>
  Array.from(container.querySelectorAll(".resume-diff-lists summary")).map(
    (summary) => summary.textContent,
  );

const ORIGINAL = [
  line("Alpha line one", 10),
  line("Beta line two goes away", 30),
  line("Gamma line three stays here", 50),
  line("Built a fast renderer for tiles", 70),
];
const TAILORED = [
  line("Gamma line three stays here", 10),
  line("Alpha line one", 30),
  line("Built a fast renderer for map tiles", 50),
  line("Delta brand new line", 70),
];

describe("ResumeDiffViewer", () => {
  it("shows a reordered line as green on the tailored page only, with no cut and no list", async () => {
    await show(
      [line("Alpha line one", 10), line("Beta line two", 30), line("Gamma line three", 50)],
      [line("Gamma line three", 10), line("Alpha line one", 30), line("Beta line two", 50)],
    );
    expect(container.querySelector(".resume-diff-summary")?.textContent).toBe(
      "0 removed, 0 changed, 1 added or moved. 2 lines kept as they were.",
    );
    expect(legend()).toEqual(["Removed", "Changed", "Added or moved"]);
    const [original, tailored] = columns();
    expect(Array.from(tailored?.querySelectorAll(".resume-diff-box") ?? [])).toHaveLength(1);
    expect(tailored?.querySelector(".resume-diff-box")?.getAttribute("data-status")).toBe("added");
    expect(original?.querySelector(".resume-diff-box")).toBeNull();
    expect(container.querySelector(".resume-diff-cut")).toBeNull();
    // The green lines are already on the page: there is no list of them, so with nothing removed or
    // reworded there are no lists at all.
    expect(container.querySelector(".resume-diff-lists")).toBeNull();
    expect(sections()).toEqual([]);
    expect(legend().some((label) => /^moved/iu.test(label ?? ""))).toBe(false);
  });

  it("says nothing changed when every line is where it was", async () => {
    await show(
      [line("Alpha line one", 10), line("Beta line two", 30)],
      [line("Alpha line one", 10), line("Beta line two", 30)],
    );
    expect(container.querySelector(".resume-diff-summary")?.textContent).toBe(
      "No line was removed, changed, added or moved.",
    );
    expect(container.querySelector(".resume-diff-lists")).toBeNull();
    expect(container.querySelectorAll(".resume-diff-box")).toHaveLength(0);
  });

  it("marks removed lines red on the original, new, moved and edited lines on the tailored, and lists them", async () => {
    await show(ORIGINAL, TAILORED);
    expect(container.querySelector(".resume-diff-summary")?.textContent).toBe(
      "1 removed, 1 changed, 2 added or moved. 1 lines kept as they were.",
    );
    expect(legend()).toEqual(["Removed", "Changed", "Added or moved", "Cut from here"]);
    const [original, tailored] = columns();
    const statuses = (column: Element | undefined) =>
      Array.from(column?.querySelectorAll(".resume-diff-box") ?? [])
        .map((box) => box.getAttribute("data-status"))
        .sort();
    expect(statuses(original)).toEqual(["changed", "removed"]);
    expect(statuses(tailored)).toEqual(["added", "added", "changed"]);
    // Only what is not visible on the tailored page is listed: the removed line and the reworded words.
    expect(sections()).toEqual(["Removed (1)", "Changed (1)"]);
    expect(container.querySelectorAll(".resume-diff-canvas")).toHaveLength(2);
  });

  it("draws a red line where a line was cut and, with room, a tag with its first words", async () => {
    await show(ORIGINAL, TAILORED, 1600);
    const cuts = container.querySelectorAll(".resume-diff-cut");
    expect(cuts).toHaveLength(1);
    // The cut is on the tailored page only.
    expect(columns()[0]?.querySelector(".resume-diff-cut")).toBeNull();
    expect(columns()[1]?.querySelector(".resume-diff-cut")).not.toBeNull();
    const tag = container.querySelector<HTMLElement>(".resume-diff-cut-tag");
    expect(tag?.textContent).toBe("- Beta line two goes...");
    expect(tag?.getAttribute("title")).toBe("Cut here:\nBeta line two goes away");
    expect(cuts[0]?.getAttribute("aria-hidden")).toBe("true");
    // The two pages are the same size; only the tailored one has the tag column beside it.
    const widths = Array.from(container.querySelectorAll<HTMLElement>(".resume-diff-page")).map(
      (page) => page.style.width,
    );
    expect(widths).toHaveLength(2);
    expect(widths[0]).toBe(widths[1]);
    expect(container.querySelector<HTMLElement>(".resume-diff-page-wrap")?.style.width).toBe(
      `${Number.parseInt(widths[1] ?? "0", 10) + 150}px`,
    );
  });

  it("keeps the red line but drops the tags when the pages are stacked", async () => {
    await show(ORIGINAL, TAILORED, 400);
    expect(container.querySelectorAll(".resume-diff-cut")).toHaveLength(1);
    expect(container.querySelector(".resume-diff-cut-line")).not.toBeNull();
    expect(container.querySelector(".resume-diff-cut-tag")).toBeNull();
    expect(container.querySelector(".resume-diff-page-wrap")?.getAttribute("style")).not.toContain(
      "NaN",
    );
  });

  it("groups lines cut at one place into one tag", async () => {
    await show(
      [
        line("Intro line stays", 10),
        line("Gone number one here", 30),
        line("Gone number two here", 50),
        line("Outro line stays", 70),
      ],
      [line("Intro line stays", 10), line("Outro line stays", 30)],
      1600,
    );
    expect(container.querySelectorAll(".resume-diff-cut")).toHaveLength(1);
    expect(container.querySelector(".resume-diff-cut-tag")?.textContent).toBe(
      "- Gone number one here (+1)",
    );
  });
});
