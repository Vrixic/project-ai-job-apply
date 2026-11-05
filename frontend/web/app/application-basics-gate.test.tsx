// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationBasicsGate } from "./application-basics-gate";
import type { ApplicationBasics } from "./use-application-basics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement | undefined;
function show(basics: ApplicationBasics) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<ApplicationBasicsGate basics={basics} />));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe("ApplicationBasicsGate", () => {
  it("names what is missing and where to add it", () => {
    const retry = vi.fn();
    const view = show({
      status: "ready",
      retry,
      missing: [
        { key: "phone", label: "Your phone number", section: "personal" },
        { key: "education", label: "One education entry", section: "education" },
      ],
    });
    expect(view.textContent).toContain("Finish your profile before applying");
    expect(view.textContent).toContain("Your phone number (Personal)");
    expect(view.textContent).toContain("One education entry (Education)");
    expect(view.querySelector("a")?.getAttribute("href")).toBe("/profile");
    act(() => view.querySelector("button")?.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it("shows nothing once the profile is complete", () => {
    expect(show({ status: "ready", missing: [], retry: vi.fn() }).textContent).toBe("");
  });
  it("pauses applying, and offers another check, when the profile cannot be read", () => {
    const view = show({ status: "unavailable", missing: [], retry: vi.fn() });
    expect(view.querySelector('[role="alert"]')?.textContent).toContain("applying is paused");
    expect(view.querySelector("button")?.textContent).toBe("Check again");
  });
  it("says it is checking while it loads", () => {
    expect(show({ status: "loading", missing: [], retry: vi.fn() }).textContent).toContain(
      "Checking that your profile",
    );
  });
});
