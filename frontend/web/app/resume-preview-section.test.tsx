// @vitest-environment jsdom

import type { ApplicationResumePreview } from "@ai-job-apply/api-contracts";
import axe from "axe-core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyed, ResumePreviewView } from "./resume-preview-section";

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

const ready: ApplicationResumePreview = {
  status: "ready",
  matchesPacket: true,
  tailoringVersion: "1",
  contentSha256: "a".repeat(64),
  baseDocument: {
    id: "00000000-0000-7000-8000-000000000040",
    fileName: "resume.pdf",
  },
  matchedTerms: ["typescript"],
  sections: [
    {
      kind: "experience",
      heading: "Experience",
      entries: [
        {
          lines: ["Engineer, Example Co"],
          bullets: [
            { text: "Built the billing service", change: "moved_up", matchedTerms: ["billing"] },
            { text: "Mentored two engineers", change: "kept" },
            { text: "Organised the office party", change: "omitted" },
          ],
        },
      ],
    },
  ],
};

async function render(preview: ApplicationResumePreview) {
  await act(async () => root.render(<ResumePreviewView preview={preview} />));
}

describe("ResumePreviewView", () => {
  it("labels each of the candidate's own bullets and promises no added or reworded text", async () => {
    await render(ready);
    const text = container.textContent ?? "";
    expect(text).toContain("Built from resume.pdf");
    expect(text).toContain("We never add or reword anything");
    expect(text).toContain("Built the billing service");
    expect(text).toContain("(Moved up)");
    expect(text).toContain("(Kept)");
    expect(text).toContain("(Left out for this job)");
    expect(text).toContain("Matches: billing.");
    expect(text).toContain("Matches to this job found in your resume: typescript.");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("says plainly when there is no resume to tailor", async () => {
    await render({ status: "no_resume", matchesPacket: false });
    expect(container.textContent).toContain("You have not added a resume yet");
  });

  it("shows fixed copy for an unavailable resume and never upstream text", async () => {
    await render({
      status: "unavailable",
      unavailableReason: "factuality_failed",
      matchesPacket: false,
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "could not tailor your resume safely",
    );
  });

  it("renders resume text inert", async () => {
    await render({
      ...ready,
      sections: [
        {
          kind: "summary",
          entries: [{ lines: ["<img src=x onerror=alert(1)>"], bullets: [] }],
        },
      ],
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("keys repeated texts by occurrence", () => {
    expect(keyed(["a", "b", "a"], (item) => item).map((entry) => entry.key)).toEqual([
      "a#1",
      "b#1",
      "a#2",
    ]);
  });
});
