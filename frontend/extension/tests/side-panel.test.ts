import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followActiveTab } from "../lib/active-tab-follow";
import {
  isOpenPanelRequest,
  isPanelNotice,
  notifyPanel,
  OPEN_PANEL_REQUEST,
  openSidePanel,
  PANEL_NOTICE,
  registerSidePanel,
} from "../lib/side-panel";

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
    expect(sendMessage).toHaveBeenCalledWith({ panel: PANEL_NOTICE });
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
    const notice = { panel: PANEL_NOTICE };
    expect(isPanelNotice(notice, { id: "me" }, "me")).toBe(true);
    expect(isPanelNotice(notice, { id: "other" }, "me")).toBe(false);
    expect(isPanelNotice(notice, { id: "me", tab: { id: 1 } }, "me")).toBe(false);
    expect(isPanelNotice({ panel: "something_else" }, { id: "me" }, "me")).toBe(false);
    expect(isPanelNotice("panel_access_granted", { id: "me" }, "me")).toBe(false);
    expect(isPanelNotice(null, { id: "me" }, "me")).toBe(false);
  });
});

describe("opening the panel for the Apply click", () => {
  it("opens it for the window and reports whether the browser agreed", async () => {
    const open = vi.fn(async () => undefined);
    await expect(
      openSidePanel(4, { runtime: { sendMessage: vi.fn() }, sidePanel: { open } }),
    ).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith({ windowId: 4 });
    const refuse = vi.fn(async () => Promise.reject(new Error("user gesture")));
    await expect(
      openSidePanel(4, { runtime: { sendMessage: vi.fn() }, sidePanel: { open: refuse } }),
    ).resolves.toBe(false);
    const throws = vi.fn(() => {
      throw new Error("no panel");
    });
    await expect(
      openSidePanel(4, { runtime: { sendMessage: vi.fn() }, sidePanel: { open: throws } }),
    ).resolves.toBe(false);
    await expect(openSidePanel(4, { runtime: { sendMessage: vi.fn() } })).resolves.toBe(false);
  });

  it("tells the panel to look again, and stays quiet when nobody listens", async () => {
    const sendMessage = vi.fn(async (_message: unknown) => undefined);
    notifyPanel({ runtime: { sendMessage } });
    expect(sendMessage).toHaveBeenCalledWith({ panel: PANEL_NOTICE });
    expect(() =>
      notifyPanel({
        runtime: { sendMessage: vi.fn(async () => Promise.reject(new Error("no receiver"))) },
      }),
    ).not.toThrow();
    expect(() => notifyPanel({ runtime: {} as never })).not.toThrow();
    await Promise.resolve();
  });

  it("accepts a request that is exactly its schema, and nothing else", () => {
    expect(isOpenPanelRequest({ schema: OPEN_PANEL_REQUEST })).toBe(true);
    expect(isOpenPanelRequest({ schema: OPEN_PANEL_REQUEST, applicationId: "x" })).toBe(false);
    expect(isOpenPanelRequest({ schema: "application-open-panel.v2" })).toBe(false);
    expect(isOpenPanelRequest({})).toBe(false);
    expect(isOpenPanelRequest([OPEN_PANEL_REQUEST])).toBe(false);
    expect(isOpenPanelRequest(null)).toBe(false);
    expect(isOpenPanelRequest(OPEN_PANEL_REQUEST)).toBe(false);
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
    fire("message", { panel: PANEL_NOTICE }, { id: "another-extension" });
    fire("message", { panel: PANEL_NOTICE }, { id: "me", tab: { id: 1 } });
    vi.advanceTimersByTime(300);
    expect(onChange).not.toHaveBeenCalled();
    fire("message", { panel: PANEL_NOTICE }, { id: "me" });
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
