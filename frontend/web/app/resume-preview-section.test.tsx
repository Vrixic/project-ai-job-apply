// @vitest-environment jsdom

import type { ApplicationResumePreview } from "@ai-job-apply/api-contracts";
import axe from "axe-core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResumePreviewSection } from "./resume-preview-section";

const APP = "00000000-0000-7000-8000-000000000001";

const ready: ApplicationResumePreview = {
  status: "ready",
  matchesPacket: true,
  baseDocument: { id: "00000000-0000-7000-8000-000000000009", fileName: "synthetic-resume.pdf" },
  tailoringVersion: "tailoring.v1",
  contentSha256: "a".repeat(64),
  matchedTerms: ["typescript", "postgresql"],
  sections: [
    {
      kind: "experience",
      heading: "Experience",
      entries: [
        {
          lines: ["Senior Engineer - Acme Corp", "2021 - Present"],
          bullets: [
            {
              text: "Built a payments API in TypeScript serving 40 partners",
              change: "moved_up",
              matchedTerms: ["typescript"],
            },
            { text: "Reduced deploy time from 30 to 6 minutes", change: "kept" },
            { text: "Maintained PostgreSQL clusters", change: "omitted" },
            { text: "Maintained PostgreSQL clusters", change: "omitted" },
          ],
        },
      ],
    },
  ],
};

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json" },
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

async function mount(
  fetchImplementation: typeof globalThis.fetch,
  onRefreshPacket?: () => Promise<void>,
) {
  await act(async () => {
    root.render(
      <ResumePreviewSection
        applicationId={APP}
        revision={2}
        fetchImplementation={fetchImplementation}
        {...(onRefreshPacket ? { onRefreshPacket } : {})}
      />,
    );
  });
}

const stub = (body: unknown, status = 200) =>
  vi.fn(async () => respond(body, status)) as unknown as typeof globalThis.fetch;

describe("ResumePreviewSection", () => {
  it("shows what changed for the candidate's own bullets with fixed labels", async () => {
    const fetchImplementation = stub(ready);
    await mount(fetchImplementation);
    const text = container.textContent ?? "";
    expect(text).toContain("Your resume for this job");
    expect(text).toContain("synthetic-resume.pdf");
    expect(text).toContain("We only reorder and trim your own bullets");
    expect(text).toContain("Experience");
    expect(text).toContain("Senior Engineer - Acme Corp");
    expect(text).toContain("Built a payments API in TypeScript serving 40 partners (Moved up)");
    expect(text).toContain("Reduced deploy time from 30 to 6 minutes (Kept)");
    expect(text).toContain("Maintained PostgreSQL clusters (Left out for this job)");
    expect(text).toContain("typescript, postgresql");
    // It asked for exactly this application's preview, read-only.
    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/platform/applications/${APP}/resume`,
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    // In sync with the packet: no warning and no re-prepare control.
    expect(text).not.toContain("changed since this packet was prepared");
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders resume text as inert text", async () => {
    const hostile: ApplicationResumePreview = {
      ...ready,
      sections: [
        {
          kind: "experience",
          entries: [
            {
              lines: ["<img src=x onerror=alert(1)>"],
              bullets: [{ text: "<script>alert(1)</script>", change: "kept" }],
            },
          ],
        },
      ],
    };
    await mount(stub(hostile));
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("warns when the resume changed since the packet, and prepares again on request", async () => {
    const onRefreshPacket = vi.fn(async () => undefined);
    await mount(stub({ ...ready, matchesPacket: false }), onRefreshPacket);
    expect(container.textContent).toContain("changed since this packet was prepared");
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Prepare again");
    await act(async () => {
      button?.click();
    });
    expect(onRefreshPacket).toHaveBeenCalledTimes(1);
  });

  it("says plainly when there is no resume to attach", async () => {
    await mount(stub({ status: "no_resume", matchesPacket: false }));
    expect(container.textContent).toContain("You have not added a resume yet, so none is attached");
    expect(container.textContent).not.toContain("Moved up");
  });

  it("uses fixed copy for each unavailable reason and for a failed request", async () => {
    await mount(
      stub({ status: "unavailable", unavailableReason: "render_failed", matchesPacket: false }),
    );
    expect(container.textContent).toContain("We could not build a file from your tailored resume");
    expect(container.querySelector("[role=alert]")).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    await mount(
      stub(
        {
          type: "urn:ai-job-apply:problem:applications_unavailable",
          title: "SECRET upstream title",
          status: 503,
          code: "applications_unavailable",
        },
        503,
      ),
    );
    expect(container.textContent).toContain("We could not check your resume right now");
    expect(container.textContent).not.toContain("SECRET");
  });

  it("ignores a malformed body instead of rendering it", async () => {
    await mount(stub({ status: "ready" }));
    expect(container.textContent).toContain("We could not check your resume right now");
  });

  it("has no automated accessibility violations in its main states", async () => {
    for (const body of [
      ready,
      { ...ready, matchesPacket: false },
      { status: "no_resume", matchesPacket: false },
      { status: "unavailable", unavailableReason: "document_unreadable", matchesPacket: false },
    ]) {
      act(() => root.unmount());
      root = createRoot(container);
      await mount(stub(body), async () => undefined);
      const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations.map((v) => v.id)).toEqual([]);
    }
  });
});
