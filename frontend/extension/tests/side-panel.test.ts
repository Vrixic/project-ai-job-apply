import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followActiveTab } from "../lib/active-tab-follow";
import { isPanelAccessGranted, PANEL_ACCESS_GRANTED, registerSidePanel } from "../lib/side-panel";

describe("the toolbar icon opens the side panel", () => {
  function install(open = vi.fn(async () => undefined)) {
    let click: (tab: chrome.tabs.Tab) => void = () => undefined;
    const sendMessage = vi.fn(async (_message: unknown) => undefined);
    registerSidePanel({
      action: {
        onClicked: {
          addListener: (listener) => {
            click = listener;
          },
        },
      },
      runtime: { sendMessage },
      sidePanel: { open },
    });
    return {
      click: (tab: Partial<chrome.tabs.Tab>) => click(tab as chrome.tabs.Tab),
      open,
      sendMessage,
    };
  }

  it("opens the panel for the window that was clicked, in the click's own turn", () => {
    const { click, open } = install();
    click({ id: 5, windowId: 9 });
    expect(open).toHaveBeenCalledWith({ windowId: 9 });
  });

  it("tells an open panel that the extension may now use the page", () => {
    const { click, sendMessage } = install();
    click({ id: 5, windowId: 9 });
    expect(sendMessage).toHaveBeenCalledWith({ panel: PANEL_ACCESS_GRANTED });
  });

  it("does not open a panel for a window it cannot name", () => {
    const { click, open } = install();
    click({ id: 5 });
    click({ id: 5, windowId: -1 });
    expect(open).not.toHaveBeenCalled();
  });

  it("stays quiet when the browser has no panel or nobody is listening", async () => {
    const throwing = install(
      vi.fn(() => {
        throw new Error("no side panel");
      }),
    );
    throwing.sendMessage.mockRejectedValue(new Error("Receiving end does not exist."));
    expect(() => throwing.click({ id: 5, windowId: 9 })).not.toThrow();
    const rejecting = install(vi.fn(async () => Promise.reject(new Error("refused"))));
    expect(() => rejecting.click({ id: 5, windowId: 9 })).not.toThrow();
    await Promise.resolve();
  });

  it("runs without the panel APIs, as in a browser that lacks them", () => {
    expect(() => registerSidePanel({ runtime: { sendMessage: vi.fn() } })).not.toThrow();
  });

  it("accepts the access notice only from the extension's own background", () => {
    const notice = { panel: PANEL_ACCESS_GRANTED };
    expect(isPanelAccessGranted(notice, { id: "me" }, "me")).toBe(true);
    expect(isPanelAccessGranted(notice, { id: "other" }, "me")).toBe(false);
    expect(isPanelAccessGranted(notice, { id: "me", tab: { id: 1 } }, "me")).toBe(false);
    expect(isPanelAccessGranted({ panel: "something_else" }, { id: "me" }, "me")).toBe(false);
    expect(isPanelAccessGranted("panel_access_granted", { id: "me" }, "me")).toBe(false);
    expect(isPanelAccessGranted(null, { id: "me" }, "me")).toBe(false);
  });
});

describe("the panel follows the page in front of the candidate", () => {
  type Listener = (...args: never[]) => void;
  const listeners: Record<string, Listener> = {};
  const add = (name: string) => ({
    addListener: (listener: Listener) => {
      listeners[name] = listener;
    },
    removeListener: vi.fn(),
  });
  const api = () => ({
    runtime: { id: "me", onMessage: add("message") },
    tabs: { onActivated: add("activated"), onUpdated: add("updated") },
    windows: { onFocusChanged: add("focus") },
  });
  const fire = (name: string, ...args: unknown[]) =>
    (listeners[name] as Listener)(...(args as never[]));

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reacts once, after things settle, when another tab is shown", () => {
    const onChange = vi.fn();
    followActiveTab(onChange, api());
    fire("activated", { tabId: 2 });
    fire("activated", { tabId: 3 });
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("reacts when the active tab finishes loading or changes address, not when a hidden tab does", () => {
    const onChange = vi.fn();
    followActiveTab(onChange, api());
    fire("updated", 4, { status: "complete" }, { active: false });
    fire("updated", 4, { status: "loading" }, { active: true });
    fire("updated", 4, { title: "x" }, { active: true });
    vi.advanceTimersByTime(300);
    expect(onChange).not.toHaveBeenCalled();
    fire("updated", 4, { status: "complete" }, { active: true });
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    fire("updated", 4, { url: "https://example.invalid/next" }, { active: true });
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("reacts when another window takes focus", () => {
    const onChange = vi.fn();
    followActiveTab(onChange, api());
    fire("focus", 12);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("reacts to the background's access notice, and to nothing else sent to the panel", () => {
    const onChange = vi.fn();
    followActiveTab(onChange, api());
    fire("message", { panel: "something_else" }, { id: "me" });
    fire("message", { panel: PANEL_ACCESS_GRANTED }, { id: "another-extension" });
    fire("message", { panel: PANEL_ACCESS_GRANTED }, { id: "me", tab: { id: 1 } });
    vi.advanceTimersByTime(300);
    expect(onChange).not.toHaveBeenCalled();
    fire("message", { panel: PANEL_ACCESS_GRANTED }, { id: "me" });
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stops listening and drops a pending change when asked", () => {
    const onChange = vi.fn();
    const stop = followActiveTab(onChange, api());
    fire("activated", { tabId: 2 });
    stop();
    vi.advanceTimersByTime(300);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("runs where the tab APIs are missing", () => {
    expect(() => followActiveTab(vi.fn(), { runtime: { id: "me" } })).not.toThrow();
  });
});
