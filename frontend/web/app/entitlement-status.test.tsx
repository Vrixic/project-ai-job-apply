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
    await act(async () => root.render(<EntitlementStatus authenticated={false} />));
    expect(oldSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("Sign in to view");
    await act(async () => root.render(<EntitlementStatus authenticated />));
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
  });
});
