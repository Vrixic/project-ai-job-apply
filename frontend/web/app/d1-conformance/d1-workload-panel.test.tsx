// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { D1WorkloadPanel } from "./d1-workload-panel";

describe("D1WorkloadPanel", () => {
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

  it("offers only managed login when the session is absent", async () => {
    await act(async () => root.render(<D1WorkloadPanel authenticated={false} />));
    const login = container.querySelector('a[href="/auth/login?returnTo=/d1-conformance"]');
    expect(login?.textContent).toContain("Log in");
    expect(container.querySelector("button")).toBeNull();
  });

  it("requires explicit confirmation before sending the fixed request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => root.render(<D1WorkloadPanel authenticated />));
    const button = container.querySelector("button") as HTMLButtonElement;
    await act(async () => button.click());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders only aggregate successful metrics", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        state: "passed",
        metrics: {
          profile: "d1_deployed_read_v1",
          publicRequests: 150,
          authenticatedRequests: 100,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<D1WorkloadPanel authenticated />));
    const button = container.querySelector("button") as HTMLButtonElement;
    await act(async () => button.click());
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/d1-conformance/workload",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ confirmation: "run-d1-development-read-workload-v1" }),
      }),
    );
    expect(container.textContent).toContain("The D1 workload passed");
    expect(container.textContent).toContain('"publicRequests": 150');
    expect(container.textContent).not.toContain("server-held-secret-token");
  });
});
