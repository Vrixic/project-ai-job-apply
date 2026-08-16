// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVED_JOBS_CHANGED_EVENT, SavedJobsPanel } from "./saved-jobs-panel";

const savedJob = {
  id: "00000000-0000-7000-8000-000000000001",
  requestedJobId: "00000000-0000-7000-8000-000000000002",
  snapshot: {
    jobIdAtSave: "00000000-0000-7000-8000-000000000002",
    company: { id: "00000000-0000-7000-8000-000000000003", name: "Synthetic Company" },
    title: "Synthetic Engineer",
    locations: ["Remote - US"],
    firstObservedAt: "2026-08-11T12:00:00.000Z",
    lastVerifiedAt: "2026-08-11T12:00:00.000Z",
    expiresAt: "2026-09-10T12:00:00.000Z",
  },
  availability: { state: "unavailable" },
  savedAt: "2026-08-15T12:00:00.000Z",
} as const;

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("SavedJobsPanel", () => {
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
    vi.unstubAllGlobals();
  });

  it("renders retained unavailable snapshots and removes only the selected association", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [savedJob] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<SavedJobsPanel authenticated />));
    await act(async () => {});
    expect(container.textContent).toContain("Synthetic Engineer");
    expect(container.textContent).toContain("no longer available");

    const remove = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Remove"),
    );
    await act(async () => remove?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/platform/saved-jobs/${savedJob.id}`);
    expect(container.textContent).not.toContain("Synthetic Engineer");
  });

  it("restarts pagination after delete and never reuses the invalidated cursor", async () => {
    const refreshedJob = {
      ...savedJob,
      id: "00000000-0000-7000-8000-000000000010",
      requestedJobId: "00000000-0000-7000-8000-000000000011",
      snapshot: { ...savedJob.snapshot, title: "Refreshed Engineer" },
    };
    const laterJob = {
      ...savedJob,
      id: "00000000-0000-7000-8000-000000000020",
      requestedJobId: "00000000-0000-7000-8000-000000000021",
      snapshot: { ...savedJob.snapshot, title: "Later Engineer" },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [savedJob], nextCursor: "stale.signature" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json({ items: [refreshedJob], nextCursor: "fresh.signature" }),
      )
      .mockResolvedValueOnce(Response.json({ items: [laterJob] }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<SavedJobsPanel authenticated />));
    await act(async () => {});

    const remove = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Remove"),
    );
    await act(async () => remove?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ pageSize: 20 });
    expect(container.textContent).toContain("Refreshed Engineer");

    const loadMore = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Load more saved jobs"),
    );
    await act(async () => loadMore?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      pageSize: 20,
      cursor: "fresh.signature",
    });
    expect(container.textContent).toContain("Later Engineer");
  });

  it("drops the deleted item and stale cursor when the restart fetch fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [savedJob], nextCursor: "stale.signature" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json(
          {
            type: "about:blank",
            title: "Saved jobs unavailable",
            status: 503,
            code: "saved_jobs_unavailable",
          },
          { status: 503 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<SavedJobsPanel authenticated />));
    await act(async () => {});
    const remove = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Remove"),
    );
    await act(async () => remove?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).not.toContain("Synthetic Engineer");
    expect(container.textContent).not.toContain("Load more saved jobs");
    expect(container.textContent).toContain("Saved jobs unavailable");
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ pageSize: 20 });
  });

  it("aborts and clears private saved state when authentication changes", async () => {
    const deferred = deferredResponse();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((_input, init) => {
        signal = init?.signal ?? undefined;
        return deferred.promise;
      }),
    );
    await act(async () => root.render(<SavedJobsPanel authenticated />));
    await act(async () => root.render(<SavedJobsPanel authenticated={false} />));
    expect(signal?.aborted).toBe(true);
    await act(async () => deferred.resolve(Response.json({ items: [savedJob] })));
    expect(container.textContent).not.toContain("Synthetic Engineer");
    expect(container.textContent).toContain("Sign in");
  });

  it("aborts an older load-more request when a refresh replaces the list", async () => {
    const loadMore = deferredResponse();
    const refresh = deferredResponse();
    const refreshedJob = {
      ...savedJob,
      id: "00000000-0000-7000-8000-000000000010",
      requestedJobId: "00000000-0000-7000-8000-000000000011",
      snapshot: { ...savedJob.snapshot, title: "Refreshed Engineer" },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [savedJob], nextCursor: "page.signature" }))
      .mockImplementationOnce(() => loadMore.promise)
      .mockImplementationOnce(() => refresh.promise);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<SavedJobsPanel authenticated />));
    await act(async () => {});
    const loadMoreButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Load more saved jobs"),
    );
    await act(async () =>
      loadMoreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    const loadMoreSignal = fetchMock.mock.calls[1]?.[1]?.signal;
    await act(async () => window.dispatchEvent(new Event(SAVED_JOBS_CHANGED_EVENT)));
    expect(loadMoreSignal?.aborted).toBe(true);

    await act(async () => refresh.resolve(Response.json({ items: [refreshedJob] })));
    await act(async () => loadMore.resolve(Response.json({ items: [{ ...savedJob, id: "old" }] })));
    expect(container.textContent).toContain("Refreshed Engineer");
    expect(container.textContent).not.toContain("Synthetic Engineer");
  });
});
