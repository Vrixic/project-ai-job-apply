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
});

async function show(original: TextLine[], tailored: TextLine[]) {
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

describe("ResumeDiffViewer", () => {
  it("does not report reordering: the same lines in another order are simply kept", async () => {
    await show(
      [line("Alpha line one", 10), line("Beta line two", 30), line("Gamma line three", 50)],
      [line("Gamma line three", 10), line("Alpha line one", 30), line("Beta line two", 50)],
    );
    expect(container.querySelector(".resume-diff-summary")?.textContent).toBe(
      "No line was removed, changed or added.",
    );
    expect(container.textContent).not.toMatch(/\bmoved\b/iu);
    expect(container.querySelector('[data-status="moved"]')).toBeNull();
    expect(container.querySelector(".resume-diff-lists")).toBeNull();
  });

  it("marks and lists only what was removed, changed or added, with no moved section", async () => {
    await show(
      [
        line("Alpha line one", 10),
        line("Beta line two goes away", 30),
        line("Gamma line three stays here", 50),
        line("Built a fast renderer for tiles", 70),
      ],
      [
        line("Gamma line three stays here", 10),
        line("Alpha line one", 30),
        line("Built a fast renderer for map tiles", 50),
        line("Delta brand new line", 70),
      ],
    );
    expect(container.querySelector(".resume-diff-summary")?.textContent).toBe(
      "1 removed, 1 changed, 1 added. 2 lines kept as they were.",
    );
    expect(legend()).toEqual(["Removed", "Changed", "Added"]);
    const sections = Array.from(container.querySelectorAll(".resume-diff-lists summary")).map(
      (summary) => summary.textContent,
    );
    expect(sections).toEqual(["Removed (1)", "Changed (1)", "Added (1)"]);
    expect(container.textContent).not.toMatch(/\bmoved\b/iu);
    // Both pages are drawn, each with a box only over the lines that are not kept.
    expect(container.querySelectorAll(".resume-diff-canvas")).toHaveLength(2);
    const boxes = Array.from(container.querySelectorAll(".resume-diff-box")).map((box) =>
      box.getAttribute("data-status"),
    );
    expect(boxes.sort()).toEqual(["added", "changed", "changed", "removed"]);
  });
});
