// @vitest-environment jsdom

import type { Application, CanonicalJobDetail } from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLICATIONS_CHANGED_EVENT } from "../lib/applications-client";
import { AppliedJobsPanel } from "./applied-jobs-panel";

const APP_1 = "00000000-0000-7000-8000-000000000001";
const APP_2 = "00000000-0000-7000-8000-000000000002";
const JOB_1 = "00000000-0000-7000-8000-000000000011";
const JOB_2 = "00000000-0000-7000-8000-000000000012";
const AT = "2026-09-18T12:00:00.000Z";
const CONFIRMED_AT = "2026-09-20T09:00:00.000Z";

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: APP_1,
    canonicalJobId: JOB_1,
    status: "applied",
    revision: 3,
    currentAction: "none",
    attempts: [
      {
        id: "00000000-0000-7000-8000-000000000021",
        sequence: 1,
        status: "confirmed",
        adapterId: "manual",
        adapterVersion: "none",
        startedAt: AT,
        confirmation: { kind: "user_attested", observedAt: CONFIRMED_AT },
      },
    ],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  } as Application;
}

function jobDetail(overrides: Partial<CanonicalJobDetail> = {}): CanonicalJobDetail {
  return {
    id: JOB_1,
    company: { name: "Atticus" },
    title: "Fullstack Engineer",
    locations: ["Remote"],
    description: "",
    status: "active",
    firstObservedAt: AT,
    lastVerifiedAt: AT,
    expiresAt: AT,
    sources: [],
    ...overrides,
  } as unknown as CanonicalJobDetail;
}

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
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

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  });
}

describe("AppliedJobsPanel", () => {
  it("refreshes confirmed history after submission without reloading the page", async () => {
    let confirmed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/search")
          ? respond({ items: confirmed ? [application()] : [] })
          : respond(jobDetail()),
      ),
    );
    act(() => root.render(<AppliedJobsPanel authenticated />));
    await flush();
    expect(container.textContent).toContain("No applications confirmed yet");
    confirmed = true;
    act(() => window.dispatchEvent(new Event(APPLICATIONS_CHANGED_EVENT)));
    await flush();
    expect(container.textContent).toContain("Fullstack Engineer");
    expect(container.textContent).toContain("Submission confirmed by you");
  });
  it("reports incomplete history when the upstream cursor loops", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ items: [application()], nextCursor: "same-page" })),
    );
    act(() => root.render(<AppliedJobsPanel authenticated />));
    await flush();
    expect(container.textContent).toContain("Applied jobs are temporarily unavailable");
    expect(container.textContent).not.toContain("No applications confirmed yet");
  });
  it("renders nothing when unauthenticated", () => {
    act(() => root.render(<AppliedJobsPanel authenticated={false} />));
    expect(container.textContent).toBe("");
  });

  it("shows empty copy when there are no confirmed applications", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ items: [] })),
    );
    act(() => root.render(<AppliedJobsPanel authenticated />));
    await flush();
    expect(container.textContent).toContain("No applications confirmed yet.");
  });

  it("excludes non-applied statuses and renders job details for applied ones", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/platform/applications/search")) {
        return respond({
          items: [
            application({ id: APP_1, canonicalJobId: JOB_1, status: "applied" }),
            application({ id: APP_2, canonicalJobId: JOB_2, status: "preparing" }),
          ],
        });
      }
      if (url.endsWith(`/api/platform/jobs/${JOB_1}`)) {
        return respond(jobDetail());
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => root.render(<AppliedJobsPanel authenticated />));
    await flush();

    expect(container.textContent).toContain("Fullstack Engineer");
    expect(container.textContent).toContain("Atticus");
    expect(container.textContent).toContain("Remote");
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining(JOB_2), expect.anything());
  });

  it("shows a fixed message when the applied job's posting can no longer be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/platform/applications/search")) {
          return respond({ items: [application()] });
        }
        return respond({ code: "not_found" }, 404);
      }),
    );
    act(() => root.render(<AppliedJobsPanel authenticated />));
    await flush();
    expect(container.textContent).toContain("Posting no longer available");
    expect(container.textContent).toContain("This job can no longer be viewed.");
  });

  it("follows nextCursor to collect every confirmed application", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/platform/applications/search")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { cursor?: string };
        if (!body.cursor) {
          return respond({
            items: [application({ id: APP_1, canonicalJobId: JOB_1 })],
            nextCursor: "page-2",
          });
        }
        return respond({ items: [application({ id: APP_2, canonicalJobId: JOB_2 })] });
      }
      return respond(jobDetail());
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => root.render(<AppliedJobsPanel authenticated />));
    await flush();

    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
});
