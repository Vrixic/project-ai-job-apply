// @vitest-environment jsdom

import axe from "axe-core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResumeCompareSheet } from "./resume-compare-sheet";

let container: HTMLDivElement;
let root: Root;
let closed: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  closed = vi.fn<() => void>();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
const slideOut = () => wait(320);

async function open() {
  await act(async () =>
    root.render(
      <ResumeCompareSheet title="What changed in your resume" onClose={closed}>
        <button type="button">First inside</button>
        <button type="button">Last inside</button>
      </ResumeCompareSheet>,
    ),
  );
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const sheet = () => document.querySelector<HTMLElement>(".resume-sheet");
const insideButtons = () => Array.from(dialog()?.querySelectorAll("button") ?? []);
const press = (key: string, options: KeyboardEventInit = {}) =>
  act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...options }),
    );
  });

describe("ResumeCompareSheet", () => {
  it("is a labelled modal dialog outside the page's own markup, with focus on Close", async () => {
    await open();
    const panel = dialog();
    expect(container.contains(panel)).toBe(false);
    expect(panel?.getAttribute("aria-modal")).toBe("true");
    const label = document.getElementById(panel?.getAttribute("aria-labelledby") ?? "");
    expect(label?.textContent).toBe("What changed in your resume");
    expect(document.activeElement?.textContent).toBe("Close");
    expect(document.body.style.overflow).toBe("hidden");
    expect((await axe.run(panel as HTMLElement)).violations).toEqual([]);
  });

  it("slides in after its first paint", async () => {
    await open();
    await wait(60);
    expect(sheet()?.getAttribute("data-state")).toBe("open");
  });

  it("keeps Tab and Shift+Tab inside the panel", async () => {
    await open();
    const [close, first, last] = insideButtons();
    expect(insideButtons().map((button) => button.textContent)).toEqual([
      "Close",
      "First inside",
      "Last inside",
    ]);
    (last as HTMLElement).focus();
    const forward = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => {
      last?.dispatchEvent(forward);
    });
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    const backward = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      close?.dispatchEvent(backward);
    });
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    // In the middle, Tab is left to the browser.
    (first as HTMLElement).focus();
    const middle = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => {
      first?.dispatchEvent(middle);
    });
    expect(middle.defaultPrevented).toBe(false);
  });

  it.each([
    ["the Close button", () => insideButtons()[0]?.click()],
    ["Escape", () => press("Escape")],
    [
      "a click beside the panel",
      () => document.querySelector<HTMLElement>(".resume-sheet-scrim")?.click(),
    ],
  ])("slides out and then closes once for %s", async (_name, close) => {
    await open();
    await wait(60);
    await act(async () => {
      await close();
    });
    expect(sheet()?.getAttribute("data-state")).toBe("leaving");
    expect(closed).not.toHaveBeenCalled();
    // Asking again while it leaves does nothing more.
    await press("Escape");
    await slideOut();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("closes at once, without sliding, when the person prefers reduced motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    await open();
    await act(async () => insideButtons()[0]?.click());
    expect(closed).toHaveBeenCalledTimes(1);
    expect(sheet()?.getAttribute("data-state")).not.toBe("leaving");
  });

  it("gives the page its scrolling back when it goes away", async () => {
    document.body.style.overflow = "auto";
    await open();
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => root.render(null));
    expect(document.body.style.overflow).toBe("auto");
    expect(dialog()).toBeNull();
    document.body.style.overflow = "";
  });
});
