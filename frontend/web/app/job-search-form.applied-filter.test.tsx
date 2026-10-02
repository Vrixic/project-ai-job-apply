// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const activeJob = {
  id: "00000000-0000-7000-8000-000000000101",
  company: { name: "Atticus" },
  title: "Fullstack Engineer",
  locations: ["Remote"],
  status: "active",
  firstObservedAt: "2026-09-18T12:00:00.000Z",
  lastVerifiedAt: "2026-09-18T12:00:00.000Z",
  expiresAt: "2027-09-18T12:00:00.000Z",
};

const appliedJob = {
  ...activeJob,
  id: "00000000-0000-7000-8000-000000000102",
  title: "Backend Engineer",
};

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let container: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  });
}

describe("JobSearchForm with Applications enabled", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APPLICATIONS_UI", "enabled");
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
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("excludes a confirmed-applied job from search results", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/platform/jobs/search")) {
        return respond({ items: [activeJob, appliedJob] });
      }
      if (url.endsWith("/api/platform/applications/search")) {
        return respond({
          items: [
            {
              id: "00000000-0000-7000-8000-000000000201",
              canonicalJobId: appliedJob.id,
              status: "applied",
              revision: 1,
              currentAction: "none",
              attempts: [],
              createdAt: "2026-09-18T12:00:00.000Z",
              updatedAt: "2026-09-18T12:00:00.000Z",
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url} ${String(init?.method)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { JobSearchForm } = await import("./job-search-form");

    await act(async () => {
      root.render(<JobSearchForm authenticated savedPanel={<div />} appliedPanel={<div />} />);
    });
    await flush();

    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!submit) throw new Error("Missing Search submit button");
    await act(async () => {
      submit.click();
    });
    await flush();

    expect(container.textContent).toContain("Fullstack Engineer");
    expect(container.textContent).not.toContain("Backend Engineer");
  });
});
