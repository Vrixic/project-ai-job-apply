// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationBasicsDialog, profileHrefFor } from "./application-basics-gate";
import { type ApplicationBasics, screeningRequired } from "./use-application-basics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement | undefined;
function show(basics: ApplicationBasics, open = true, onClose = vi.fn()) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(<ApplicationBasicsDialog basics={basics} open={open} onClose={onClose} />),
  );
  return host;
}
const basics = (extra: Partial<ApplicationBasics> = {}): ApplicationBasics => ({
  status: "ready",
  missing: [],
  answers: {},
  salary: undefined,
  retry: vi.fn(),
  ...extra,
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

const missing = [
  { key: "phone", label: "Your phone number", section: "personal" as const },
  { key: "q", label: "Are you legally authorized to work?", section: "screening" as const },
];

describe("screeningRequired", () => {
  it("is on only when the deployment says the screening answers can be saved", () => {
    expect(screeningRequired({})).toBe(false);
    expect(screeningRequired({ NEXT_PUBLIC_SCREENING_ANSWERS_REQUIRED: "enabled" })).toBe(true);
    expect(screeningRequired({ NEXT_PUBLIC_SCREENING_ANSWERS_REQUIRED: "true" })).toBe(false);
  });
});

describe("ApplicationBasicsDialog", () => {
  it("links to the first Profile tab that still has something to fill in", () => {
    expect(profileHrefFor(missing)).toBe("/profile?tab=personal&from=apply");
    expect(profileHrefFor([missing[1] as (typeof missing)[number]])).toBe(
      "/profile?tab=screening&from=apply",
    );
    expect(profileHrefFor([])).toBe("/profile");
  });
  it("tells the candidate to complete their screening and names what is missing", () => {
    const retry = vi.fn();
    const view = show(basics({ missing, retry }));
    const dialog = view.querySelector("dialog") as HTMLDialogElement;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.textContent).toContain("Complete your screening to apply");
    expect(dialog.textContent).toContain("Your phone number");
    expect(dialog.textContent).toContain("Are you legally authorized to work?");
    const link = dialog.querySelector("a");
    expect(link?.textContent).toBe("Go to my profile");
    expect(link?.getAttribute("href")).toBe("/profile?tab=personal&from=apply");
    const [again] = Array.from(dialog.querySelectorAll("button"));
    act(() => again?.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it("closes on request", () => {
    const onClose = vi.fn();
    const view = show(basics({ missing }), true, onClose);
    const buttons = Array.from(view.querySelectorAll("button"));
    act(() => buttons.at(-1)?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("stays closed until it is asked to open, and while the profile is loading", () => {
    expect(show(basics({ missing }), false).querySelector("dialog")?.hasAttribute("open")).toBe(
      false,
    );
    act(() => root?.unmount());
    host?.remove();
    expect(
      show(basics({ status: "loading" }), true)
        .querySelector("dialog")
        ?.hasAttribute("open"),
    ).toBe(false);
  });
  it("pauses applying, and offers another check, when the profile cannot be read", () => {
    const view = show(basics({ status: "unavailable" }));
    expect(view.querySelector('[role="alert"]')?.textContent).toContain("Applying is paused");
    expect(view.textContent).toContain("Check again");
  });
});
