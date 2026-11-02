// @vitest-environment jsdom

import type { CanonicalJobDetail } from "@ai-job-apply/api-contracts";
import React, { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobDetailPanel } from "./job-detail-panel";

const JOB_ID = "00000000-0000-7000-8000-000000000001";
const OTHER_JOB_ID = "00000000-0000-7000-8000-000000000009";
const PRIVATE_CANARY = "synthetic-private-detail-canary-never-render";

function detail(overrides: Partial<CanonicalJobDetail> = {}): CanonicalJobDetail {
  return {
    id: JOB_ID,
    company: { id: "00000000-0000-7000-8000-000000000002", name: "Synthetic Company" },
    title: "Synthetic Engineer",
    department: "Synthetic Engineering",
    locations: ["Remote - US"],
    description: "Build synthetic tools.\n<script>untrusted-description-text</script>",
    status: "active",
    firstObservedAt: "2026-09-01T12:00:00.000Z",
    lastVerifiedAt: "2026-09-10T12:00:00.000Z",
    expiresAt: "2026-10-10T12:00:00.000Z",
    sources: [
      {
        provider: "greenhouse",
        provenance: "authorized_fixture",
        canonicalUrl: "https://jobs.synthetic.example/positions/one",
        firstObservedAt: "2026-09-01T12:00:00.000Z",
        lastVerifiedAt: "2026-09-10T12:00:00.000Z",
        validThrough: "2026-10-01T12:00:00.000Z",
      },
      {
        provider: "ugc",
        provenance: "explicit_ugc",
        canonicalUrl: "https://careers.synthetic.example/jobs/one",
        firstObservedAt: "2026-09-02T12:00:00.000Z",
        lastVerifiedAt: "2026-09-10T12:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("JobDetailPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function button(label: string): HTMLButtonElement {
    const match = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent === label,
    );
    if (!match) throw new Error(`Missing generated test control: ${label}`);
    return match;
  }

  async function click(label = "View details and sources") {
    await act(async () => button(label).dispatchEvent(new MouseEvent("click", { bubbles: true })));
  }

  it("loads only on demand, stays single-flight, and accepts a different canonical ID", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobDetailPanel jobId={JOB_ID} authenticated />));
    expect(fetchMock).not.toHaveBeenCalled();
    const trigger = button("View details and sources");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe(`/api/platform/jobs/${JOB_ID}`);
    expect(init).toEqual(
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
      }),
    );
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toBeUndefined();
    expect(trigger.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Loading job details and sources…",
    );
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(document.activeElement).toBe(container.querySelector("h4"));

    await act(async () => pending.resolve(Response.json(detail({ id: OTHER_JOB_ID }))));
    expect(container.textContent).toContain("Synthetic Engineer");
    expect(container.textContent).toContain("Job details loaded.");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector(".job-detail-description")?.textContent).toBe(
      detail().description,
    );
    expect(container.textContent).toContain("Authorized test fixture");
    expect(container.textContent).toContain("Community contribution");
    expect(container.textContent).toContain("Source valid through");
    expect(container.querySelectorAll("a")).toHaveLength(2);
    for (const link of Array.from(container.querySelectorAll("a"))) {
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
      expect(link.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect(link.textContent).toContain("opens in a new tab");
    }
    await click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(container.querySelector("h4"));
  });

  it("shows a job's own page at once, with no toggle or close", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(detail()));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobDetailPanel standalone jobId={JOB_ID} authenticated />));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Synthetic Engineer");
    expect(container.textContent).toContain("Build synthetic tools.");
    expect(
      Array.from(container.querySelectorAll("button")).map((entry) => entry.textContent),
    ).not.toContain("View details and sources");
    expect(container.textContent).not.toContain("Close details");
    await act(async () =>
      container
        .querySelector("h4")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(container.textContent).toContain("Synthetic Engineer");
  });

  it("closes with Escape, returns focus, and makes reopening an explicit fresh read", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(detail()));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobDetailPanel jobId={JOB_ID} authenticated />));
    await click();
    await act(async () =>
      container
        .querySelector("h4")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(container.querySelector("section")).toBeNull();
    expect(container.textContent).not.toContain("Synthetic Engineer");
    expect(document.activeElement).toBe(button("View details and sources"));
    expect(button("View details and sources").getAttribute("aria-expanded")).toBe("false");
    fetchMock.mockResolvedValueOnce(Response.json(detail()));
    await click();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed on contract-invalid empty locations without inferring flexibility", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(detail({ locations: [] }))),
    );
    await act(async () => root.render(<JobDetailPanel jobId={JOB_ID} authenticated />));
    await click();
    expect(container.textContent).toContain("Job details are temporarily unavailable.");
    expect(container.textContent).not.toContain("Location flexible");
  });

  it.each([
    [401, "Sign in again to view job details and sources."],
    [403, "Your session is not allowed to view job details and sources."],
    [404, "This posting is no longer available."],
    [503, "Job details are temporarily unavailable. Try again."],
  ])(
    "uses fixed error copy for %s without reading private problem fields",
    async (status, message) => {
      const response = Response.json(
        { detail: PRIVATE_CANARY, title: PRIVATE_CANARY, code: PRIVATE_CANARY },
        { status },
      );
      const readBody = vi.spyOn(response, "json");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response)
        .mockResolvedValueOnce(Response.json(detail()));
      vi.stubGlobal("fetch", fetchMock);
      await act(async () => root.render(<JobDetailPanel jobId={JOB_ID} authenticated />));
      await click();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(message);
      expect(readBody).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain(PRIVATE_CANARY);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await click("Retry details");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain("Job details loaded.");
    },
  );

  it.each([
    "javascript:alert(1)",
    "http://jobs.synthetic.example/one",
    "https://user:secret@jobs.synthetic.example/one",
    "//jobs.synthetic.example/one",
  ])("rejects unsafe source URL %s before rendering", async (canonicalUrl) => {
    const value = detail();
    const source = value.sources[0];
    if (!source) throw new Error("Missing generated source fixture");
    source.canonicalUrl = canonicalUrl;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(value)));
    await act(async () => root.render(<JobDetailPanel jobId={JOB_ID} authenticated />));
    await click();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).not.toContain(value.description);
    expect(container.textContent).toContain("Job details are temporarily unavailable.");
  });

  it("redacts transport failures and rejects malformed successful detail payloads", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error(PRIVATE_CANARY))
      .mockResolvedValueOnce(Response.json({ ...detail(), privateInternalField: PRIVATE_CANARY }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobDetailPanel jobId={JOB_ID} authenticated />));
    await click();
    expect(container.textContent).not.toContain(PRIVATE_CANARY);
    await click("Retry details");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).not.toContain(PRIVATE_CANARY);
    expect(container.textContent).toContain("Job details are temporarily unavailable.");
  });

  it("aborts closing a pending read and fences its late completion from a reopened request", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobDetailPanel jobId={JOB_ID} authenticated />));
    await click();
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    await click("Close details");
    expect(firstSignal?.aborted).toBe(true);
    expect(document.activeElement).toBe(button("View details and sources"));
    await click();
    await act(async () => first.resolve(Response.json(detail({ description: PRIVATE_CANARY }))));
    expect(container.textContent).not.toContain(PRIVATE_CANARY);
    expect(button("View details and sources").disabled).toBe(true);
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
    await act(async () => second.resolve(Response.json(detail())));
    expect(container.textContent).toContain("Job details loaded.");
  });

  it("discards old loaded content at commit time on job changes and on sign-out", async () => {
    const observations: string[] = [];
    function Observe({ id, authenticated }: { id: string; authenticated: boolean }) {
      useLayoutEffect(() => {
        observations.push(container.textContent ?? "");
      });
      return <JobDetailPanel jobId={id} authenticated={authenticated} />;
    }
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(detail({ description: PRIVATE_CANARY }))),
    );
    await act(async () => root.render(<Observe id={JOB_ID} authenticated />));
    await click();
    expect(container.textContent).toContain(PRIVATE_CANARY);
    await act(async () => root.render(<Observe id={OTHER_JOB_ID} authenticated />));
    expect(observations.at(-1)).not.toContain(PRIVATE_CANARY);
    expect(container.querySelector("section")).toBeNull();
    await act(async () => root.render(<Observe id={OTHER_JOB_ID} authenticated={false} />));
    expect(observations.at(-1)).toBe("");
    expect(container.textContent).toBe("");
  });

  it.each(["job", "session", "unmount"])(
    "aborts and fences late responses across %s changes",
    async (change) => {
      const pending = deferred<Response>();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(() => pending.promise)
        .mockResolvedValueOnce(Response.json(detail({ id: OTHER_JOB_ID })));
      vi.stubGlobal("fetch", fetchMock);
      await act(async () => root.render(<JobDetailPanel jobId={JOB_ID} authenticated />));
      await click();
      const signal = fetchMock.mock.calls[0]?.[1]?.signal;
      if (change === "unmount") await act(async () => root.unmount());
      else
        await act(async () =>
          root.render(
            <JobDetailPanel
              jobId={change === "job" ? OTHER_JOB_ID : JOB_ID}
              authenticated={change !== "session"}
            />,
          ),
        );
      expect(signal?.aborted).toBe(true);
      await act(async () =>
        pending.resolve(Response.json(detail({ description: PRIVATE_CANARY }))),
      );
      expect(container.textContent).not.toContain(PRIVATE_CANARY);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      if (change === "unmount") root = createRoot(container);
      if (change === "session")
        await act(async () => root.render(<JobDetailPanel jobId={JOB_ID} authenticated />));
      if (change !== "unmount") {
        await click();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain("Job details loaded.");
      }
    },
  );

  it("settles a hostile success body at the deadline and protects a manual retry from its late body", async () => {
    vi.useFakeTimers();
    const staleBody = deferred<unknown>();
    const retry = deferred<Response>();
    const response = new Response(null, { status: 200 });
    Object.defineProperty(response, "json", { value: () => staleBody.promise });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response)
      .mockImplementationOnce(() => retry.promise);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobDetailPanel jobId={JOB_ID} authenticated />));
    await click();
    await act(async () => vi.advanceTimersByTimeAsync(19_999));
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(container.textContent).toContain("Job details timed out. Try again.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await click("Retry details");
    await act(async () => staleBody.resolve(detail({ description: PRIVATE_CANARY })));
    expect(container.textContent).not.toContain(PRIVATE_CANARY);
    expect(button("View details and sources").disabled).toBe(true);
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
    await act(async () => retry.resolve(Response.json(detail())));
    expect(container.textContent).toContain("Job details loaded.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses distinct disclosure identifiers for different result panels", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () =>
      root.render(
        <>
          <JobDetailPanel jobId={JOB_ID} authenticated />
          <JobDetailPanel jobId={OTHER_JOB_ID} authenticated />
        </>,
      ),
    );
    const ids = Array.from(container.querySelectorAll("button"), (entry) =>
      entry.getAttribute("aria-controls"),
    );
    expect(new Set(ids).size).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
