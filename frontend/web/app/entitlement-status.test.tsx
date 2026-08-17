// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntitlementStatus } from "./entitlement-status";

const grants = ["profile.manage", "jobs.search", "jobs.save", "applications.history"];

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("EntitlementStatus", () => {
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

  it("reads and renders only the provider-neutral current status", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        plan: "free",
        accessState: "active",
        grants,
        version: 0,
        evaluatedAt: "2026-08-16T12:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<EntitlementStatus authenticated />));
    await act(async () => {});

    expect(container.textContent).toContain("Free access");
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("Free access");
    expect(container.textContent).toContain("same four core capabilities");
    expect(container.textContent).not.toMatch(/upgrade|payment|price/i);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/platform/entitlements",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });

  it("renders a bounded grace status without adding paid-feature claims", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({
          plan: "pro",
          accessState: "grace",
          grants,
          version: 4,
          evaluatedAt: "2026-08-16T12:00:00.000Z",
          accessThrough: "2026-08-15T12:00:00.000Z",
          graceThrough: "2026-08-20T12:00:00.000Z",
        }),
      ),
    );
    await act(async () => root.render(<EntitlementStatus authenticated />));
    await act(async () => {});

    expect(container.textContent).toContain("Pro access");
    expect(container.textContent).toContain("Grace access is active through");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-08-20T12:00:00.000Z",
    );
    expect(container.textContent).not.toMatch(/upgrade|price|quota|exclusive/i);
  });

  it("fails closed on malformed or unavailable responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({
          plan: "pro",
          accessState: "active",
          grants,
          version: 1,
          evaluatedAt: "2026-08-16T12:00:00.000Z",
          provider: "must-not-render",
        }),
      ),
    );
    await act(async () => root.render(<EntitlementStatus authenticated />));
    await act(async () => {});

    expect(container.textContent).toContain("Access status is temporarily unavailable");
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain(
      "Access status is temporarily unavailable",
    );
    expect(container.textContent).not.toContain("must-not-render");
  });

  it("retries only after an explicit action and keeps the retry single-flight", async () => {
    const retryResponse = deferredResponse();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            title: "Private upstream entitlement title",
            detail: "private-entitlement-canary",
            code: "private_upstream_code",
          },
          { status: 503 },
        ),
      )
      .mockImplementationOnce(() => retryResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<EntitlementStatus authenticated />));
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Access status is temporarily unavailable");
    expect(container.textContent).not.toMatch(/private upstream|private-entitlement-canary/i);
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry access status",
    );
    expect(retry).toBeDefined();

    await act(async () => {
      retry?.click();
      retry?.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Loading access status");
    expect(container.textContent).not.toContain("Retry access status");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/platform/entitlements");
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBeUndefined();
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toBeUndefined();

    await act(async () =>
      retryResponse.resolve(
        Response.json({
          plan: "free",
          accessState: "active",
          grants,
          version: 1,
          evaluatedAt: "2026-08-16T12:01:00.000Z",
        }),
      ),
    );

    expect(container.textContent).toContain("Free access");
    expect(container.textContent).not.toMatch(/upgrade|payment|price|quota/i);
  });

  it("settles an abort-ignoring fetch at the exact deadline and retries only explicitly", async () => {
    vi.useFakeTimers();
    const stalled = deferredResponse();
    let stalledSignal: AbortSignal | undefined;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce((_input, init) => {
        stalledSignal = init?.signal ?? undefined;
        return stalled.promise;
      })
      .mockResolvedValueOnce(
        Response.json({
          plan: "free",
          accessState: "active",
          grants,
          version: 1,
          evaluatedAt: "2026-08-16T12:01:00.000Z",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<EntitlementStatus authenticated />));
    await act(async () => vi.advanceTimersByTimeAsync(19_999));
    expect(stalledSignal?.aborted).toBe(false);
    expect(container.textContent).toContain("Loading access status");
    expect(container.textContent).not.toContain("Retry access status");

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(stalledSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("Access status is temporarily unavailable");
    expect(container.textContent).toContain("Retry access status");
    expect(vi.getTimerCount()).toBe(0);

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry access status",
    );
    await act(async () => {
      retry?.click();
      retry?.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Free access");
    expect(container.textContent).not.toMatch(/upgrade|payment|price|quota/i);
  });

  it("keeps the deadline active while the response body is parsed", async () => {
    vi.useFakeTimers();
    const body = deferredResponse();
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      signal = init?.signal ?? undefined;
      return {
        ok: true,
        json: () => body.promise,
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<EntitlementStatus authenticated />));
    await act(async () => vi.advanceTimersByTimeAsync(20_000));

    expect(signal?.aborted).toBe(true);
    expect(container.textContent).toContain("Access status is temporarily unavailable");
    expect(container.textContent).toContain("Retry access status");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline after a successful complete response", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        signal = init?.signal ?? undefined;
        return Response.json({
          plan: "free",
          accessState: "active",
          grants,
          version: 0,
          evaluatedAt: "2026-08-16T12:00:00.000Z",
        });
      }),
    );

    await act(async () => root.render(<EntitlementStatus authenticated />));
    await act(async () => {});
    expect(container.textContent).toContain("Free access");
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(signal?.aborted).toBe(false);
    expect(container.textContent).toContain("Free access");
  });

  it("restores the same bounded failure after an unsuccessful retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ unexpected: true }))
      .mockResolvedValueOnce(
        Response.json(
          { title: "private-title", detail: "private-detail", trace: "private-trace" },
          { status: 503 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<EntitlementStatus authenticated />));
    await act(async () => {});
    await act(async () => {
      const retry = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Retry access status",
      );
      retry?.click();
    });
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Access status is temporarily unavailable");
    expect(container.textContent).toContain("Retry access status");
    expect(container.textContent).not.toMatch(/private-title|private-detail|private-trace/i);
  });

  it("rejects a non-RFC timestamp without rendering it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({
          plan: "free",
          accessState: "active",
          grants,
          version: 0,
          evaluatedAt: "August 16, 2026",
        }),
      ),
    );
    await act(async () => root.render(<EntitlementStatus authenticated />));
    await act(async () => {});

    expect(container.textContent).toContain("Access status is temporarily unavailable");
    expect(container.textContent).not.toContain("August 16");
  });

  it("never paints a stale account response across sign-out and sign-in", async () => {
    vi.useFakeTimers();
    const oldAccount = deferredResponse();
    const newAccount = deferredResponse();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => oldAccount.promise)
      .mockImplementationOnce(() => newAccount.promise);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<EntitlementStatus authenticated />));
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain(
      "Loading access status",
    );
    const oldSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.render(<EntitlementStatus authenticated={false} />));
    expect(oldSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(container.textContent).toContain("Sign in to view");
    await act(async () => root.render(<EntitlementStatus authenticated />));
    expect(vi.getTimerCount()).toBe(1);
    expect(container.textContent).not.toContain("Pro access");

    await act(async () =>
      oldAccount.resolve(
        Response.json({
          plan: "pro",
          accessState: "active",
          grants,
          version: 9,
          evaluatedAt: "2026-08-16T12:00:00.000Z",
          accessThrough: "2026-09-16T12:00:00.000Z",
        }),
      ),
    );
    expect(container.textContent).not.toContain("Pro access");
    await act(async () =>
      newAccount.resolve(
        Response.json({
          plan: "free",
          accessState: "active",
          grants,
          version: 0,
          evaluatedAt: "2026-08-16T12:01:00.000Z",
        }),
      ),
    );
    expect(container.textContent).toContain("Free access");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fences an in-flight retry across sign-out and sign-in", async () => {
    const oldRetry = deferredResponse();
    const newAccount = deferredResponse();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ unavailable: true }))
      .mockImplementationOnce(() => oldRetry.promise)
      .mockImplementationOnce(() => newAccount.promise);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<EntitlementStatus authenticated />));
    await act(async () => {});
    await act(async () => {
      const retry = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Retry access status",
      );
      retry?.click();
    });
    const oldRetrySignal = fetchMock.mock.calls[1]?.[1]?.signal;

    await act(async () => root.render(<EntitlementStatus authenticated={false} />));
    expect(oldRetrySignal?.aborted).toBe(true);
    expect(container.textContent).toContain("Sign in to view");
    await act(async () => root.render(<EntitlementStatus authenticated />));

    await act(async () =>
      oldRetry.resolve(
        Response.json({
          plan: "pro",
          accessState: "active",
          grants,
          version: 7,
          evaluatedAt: "2026-08-16T12:02:00.000Z",
          accessThrough: "2026-09-16T12:00:00.000Z",
        }),
      ),
    );
    expect(container.textContent).not.toContain("Pro access");

    await act(async () =>
      newAccount.resolve(
        Response.json({
          plan: "free",
          accessState: "active",
          grants,
          version: 0,
          evaluatedAt: "2026-08-16T12:03:00.000Z",
        }),
      ),
    );
    expect(container.textContent).toContain("Free access");
  });

  it("aborts an in-flight retry when the surface unmounts", async () => {
    vi.useFakeTimers();
    const retryResponse = deferredResponse();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ unavailable: true }))
      .mockImplementationOnce(() => retryResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<EntitlementStatus authenticated />));
    await act(async () => {});
    await act(async () => {
      const retry = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Retry access status",
      );
      retry?.click();
    });
    const retrySignal = fetchMock.mock.calls[1]?.[1]?.signal;
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => root.unmount());
    expect(retrySignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () =>
      retryResponse.resolve(
        Response.json({
          plan: "pro",
          accessState: "active",
          grants,
          version: 3,
          evaluatedAt: "2026-08-16T12:04:00.000Z",
          accessThrough: "2026-09-16T12:00:00.000Z",
        }),
      ),
    );
    expect(container.textContent).toBe("");
    root = createRoot(container);
  });
});
