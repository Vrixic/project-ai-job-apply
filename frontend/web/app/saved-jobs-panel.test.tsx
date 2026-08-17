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

const privateCanary = "synthetic-private-saved-jobs-canary-never-render";

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

  it("makes rapid remove activation synchronously single-flight", async () => {
    const pendingDelete = deferredResponse();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [savedJob] }))
      .mockImplementationOnce(() => pendingDelete.promise)
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<SavedJobsPanel authenticated />));
    await act(async () => {});
    const remove = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Remove"),
    );

    await act(async () => {
      remove?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      remove?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
    await act(async () => pendingDelete.resolve(new Response(null, { status: 204 })));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("bounds a stalled list request and supports an explicit retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("private list abort", "AbortError")),
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce(Response.json({ items: [savedJob] }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<SavedJobsPanel authenticated />));

    await act(async () => vi.advanceTimersByTimeAsync(20_000));

    expect(container.textContent).toContain("Loading saved jobs timed out. Try again.");
    expect(container.textContent).not.toContain("private list abort");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    const retry = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Retry saved jobs"),
    );
    await act(async () => retry?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Synthetic Engineer");
    expect(container.textContent).not.toContain("Retry saved jobs");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a saved job after delete timeout and retries the same idempotent target explicitly", async () => {
    vi.useFakeTimers();
    const refresh = deferredResponse();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [savedJob] }))
      .mockImplementationOnce(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("private delete abort", "AbortError")),
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockImplementationOnce(() => refresh.promise);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<SavedJobsPanel authenticated />));
    await act(async () => {});
    const remove = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Remove"),
    );
    await act(async () => remove?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    await act(async () => vi.advanceTimersByTimeAsync(20_000));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Synthetic Engineer");
    expect(container.textContent).toContain(
      "Removing the saved job timed out. Retry to safely check the same saved job.",
    );
    expect(container.textContent).not.toContain("private delete abort");
    expect(remove?.disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => remove?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/platform/saved-jobs/${savedJob.id}`);
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`/api/platform/saved-jobs/${savedJob.id}`);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("DELETE");
    expect(container.textContent).not.toContain("Synthetic Engineer");
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => refresh.resolve(Response.json({ items: [] })));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(vi.getTimerCount()).toBe(0);
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
            detail: privateCanary,
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
    expect(container.textContent).toContain("Saved jobs are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateCanary);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ pageSize: 20 });
    expect(document.activeElement).toBe(container.querySelector("#saved-jobs-heading"));
  });

  it("renders bounded errors without exposing list or delete problem details", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            title: "Private upstream title",
            detail: privateCanary,
            code: "saved_jobs_unavailable",
          },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ items: [savedJob] }))
      .mockResolvedValueOnce(
        Response.json(
          {
            title: "Private delete title",
            detail: privateCanary,
            code: "saved_jobs_unavailable",
          },
          { status: 503 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<SavedJobsPanel authenticated />));
    await act(async () => {});
    expect(container.textContent).toContain("Saved jobs are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateCanary);
    expect(container.textContent).not.toContain("Private upstream title");

    await act(async () => window.dispatchEvent(new Event(SAVED_JOBS_CHANGED_EVENT)));
    await act(async () => {});
    const remove = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Remove"),
    );
    await act(async () => remove?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain("Saved jobs are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateCanary);
    expect(container.textContent).not.toContain("Private delete title");
    expect(container.textContent).toContain("Synthetic Engineer");
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

  it("aborts delete and drops an abort-ignoring stale completion on sign-out", async () => {
    const pendingDelete = deferredResponse();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [savedJob] }))
      .mockImplementationOnce(() => pendingDelete.promise);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<SavedJobsPanel authenticated />));
    await act(async () => {});
    const remove = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Remove"),
    );
    await act(async () => remove?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const deleteSignal = fetchMock.mock.calls[1]?.[1]?.signal;

    await act(async () => root.render(<SavedJobsPanel authenticated={false} />));

    expect(deleteSignal?.aborted).toBe(true);
    await act(async () => pendingDelete.resolve(new Response(null, { status: 204 })));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Sign in to keep a private list of jobs.");
    expect(container.textContent).not.toContain("Saved job removed.");
    expect(container.textContent).not.toContain("Synthetic Engineer");
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
