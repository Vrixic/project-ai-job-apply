// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobSearchForm } from "./job-search-form";

const firstJob = {
  id: "00000000-0000-7000-8000-000000000001",
  company: {
    id: "00000000-0000-7000-8000-000000000002",
    name: "Synthetic First Company",
  },
  title: "First-page Engineer",
  locations: ["Remote - US"],
  status: "active",
  firstObservedAt: "2026-08-10T12:00:00.000Z",
  lastVerifiedAt: "2026-08-12T12:00:00.000Z",
  expiresAt: "2026-09-12T12:00:00.000Z",
} as const;

const restartedJob = {
  ...firstJob,
  id: "00000000-0000-7000-8000-000000000003",
  company: { ...firstJob.company, id: "00000000-0000-7000-8000-000000000004" },
  title: "Restarted Catalog Engineer",
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("JobSearchForm", () => {
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

  it("announces loading and safely restarts a changed continuation without mixing pages", async () => {
    const initial = deferredResponse();
    const restarted = deferredResponse();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => initial.promise)
      .mockResolvedValueOnce(
        jsonResponse(
          {
            type: "about:blank",
            title: "Job catalog changed",
            status: 409,
            code: "job_search_catalog_changed",
            detail: "The job catalog changed; restart the search from the first page",
          },
          409,
        ),
      )
      .mockImplementationOnce(() => restarted.promise);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<JobSearchForm authenticated />));
    const form = container.querySelector("form");
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(form).not.toBeNull();
    expect(submit?.disabled).toBe(false);

    await act(async () =>
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(submit?.disabled).toBe(true);
    expect(submit?.textContent).toBe("Searching…");

    await act(async () =>
      initial.resolve(jsonResponse({ items: [firstJob], nextCursor: "signed.body" })),
    );
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("1 job loaded.");
    expect(container.textContent).toContain(firstJob.title);

    const loadMore = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Load more jobs"),
    );
    await act(async () => loadMore?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain(
      "Restarting this search",
    );
    expect(container.textContent).not.toContain(firstJob.title);
    expect(submit?.disabled).toBe(true);

    await act(async () => restarted.resolve(jsonResponse({ items: [restartedJob] })));
    expect(container.textContent).toContain(restartedJob.title);
    expect(container.textContent).not.toContain(firstJob.title);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("1 job loaded.");
    expect(submit?.disabled).toBe(false);
  });

  it("aborts a stalled component request and announces the timeout", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((_input, init) => {
        observedSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          observedSignal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }),
    );

    await act(async () => root.render(<JobSearchForm authenticated />));
    const form = container.querySelector("form");
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    await act(async () =>
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(submit?.disabled).toBe(true);

    await act(async () => vi.advanceTimersByTimeAsync(20_000));

    expect(observedSignal?.aborted).toBe(true);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain(
      "Job search timed out",
    );
    expect(submit?.disabled).toBe(false);
  });
});
