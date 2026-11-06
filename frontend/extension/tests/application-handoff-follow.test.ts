// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LINK } from "./application-handoff-fixture";

vi.mock("../lib/config", () => ({
  extensionConfiguration: {
    applicationHandoffWebOrigin: "https://candidate.example",
    applicationExecutionEnabled: true,
  },
}));

import { mountApplicationHandoff } from "../lib/application-handoff-ui";

const EMPLOYER = "https://job-boards.greenhouse.io/example/jobs/1";
type Tab = { id: number; url?: string; status?: string };
let tab: Tab;
let pending: boolean;
let send: ReturnType<typeof vi.fn>;
let tabChanged: () => void;
let tabUpdated: (
  id: number,
  change: { status?: string; url?: string },
  tab: Tab & { active: boolean },
) => void;

const status = () => document.querySelector("[data-handoff-status]")?.textContent ?? "";
const selects = () => send.mock.calls.filter(([m]) => m.action === "application_native_select");
async function settle() {
  await vi.advanceTimersByTimeAsync(300);
}
async function switchTo(next: Tab) {
  tab = next;
  tabChanged();
  await settle();
}

beforeEach(async () => {
  vi.useFakeTimers();
  tab = { id: 7, url: EMPLOYER, status: "complete" };
  pending = true;
  send = vi.fn(async (message) =>
    message.action === "application_pending_intent"
      ? pending
        ? { ok: true, reviewLink: LINK }
        : { ok: true }
      : { ok: true, resume: "generated" },
  );
  vi.stubGlobal("chrome", {
    runtime: { id: "me", sendMessage: send, onMessage: { addListener: vi.fn() } },
    storage: { onChanged: { addListener: vi.fn() } },
    tabs: {
      query: vi.fn(async () => [tab]),
      onActivated: {
        addListener: (listener: () => void) => {
          tabChanged = listener;
        },
      },
      onUpdated: {
        addListener: (listener: typeof tabUpdated) => {
          tabUpdated = listener;
        },
      },
    },
    windows: { onFocusChanged: { addListener: vi.fn() } },
  });
  document.body.innerHTML =
    '<section id="application-handoff" hidden><input><button data-handoff-load>Load</button><button data-native-select hidden>Select</button><button data-native-fill hidden>Fill</button><button data-native-apply hidden>Apply</button><button data-native-clear hidden>Clear files</button><button data-handoff-clear>Clear</button><div data-handoff-content></div><div data-handoff-status></div></section>';
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("the side panel follows the page in front of the candidate", () => {
  it("prepares the application for the employer page it is opened on", async () => {
    mountApplicationHandoff();
    await settle();
    expect(selects()).toEqual([[{ action: "application_native_select", reviewLink: LINK }]]);
    expect(status()).toContain("Employer tab selected");
  });

  it("prepares it for the next employer page without being reopened", async () => {
    mountApplicationHandoff();
    await settle();
    await switchTo({ id: 8, url: "https://job-boards.greenhouse.io/other/jobs/2" });
    expect(selects()).toHaveLength(2);
  });

  it("does not select the page it already prepared when the tab only settles again", async () => {
    mountApplicationHandoff();
    await settle();
    await switchTo({ id: 7, url: EMPLOYER });
    expect(selects()).toHaveLength(1);
  });

  it("prepares it again when the prepared tab moves to another address", async () => {
    mountApplicationHandoff();
    await settle();
    await switchTo({ id: 7, url: `${EMPLOYER}/confirmation` });
    expect(selects()).toHaveLength(2);
  });

  it("asks for the icon click on a page it cannot see, and selects nothing there", async () => {
    tab = { id: 9 };
    mountApplicationHandoff();
    await settle();
    expect(selects()).toHaveLength(0);
    expect(status()).toContain("click the ApplyDash icon");
  });

  it("waits for a page that is still loading, and prepares it once it has settled", async () => {
    tab = { id: 7, url: EMPLOYER, status: "loading" };
    mountApplicationHandoff();
    await settle();
    expect(selects()).toHaveLength(0);
    tab = { id: 7, url: EMPLOYER, status: "complete" };
    tabUpdated(7, { status: "complete" }, { ...tab, active: true });
    await settle();
    expect(selects()).toHaveLength(1);
  });

  it("prepares the page again after it reloads, since a reload is a new document", async () => {
    mountApplicationHandoff();
    await settle();
    expect(selects()).toHaveLength(1);
    // Greenhouse loads twice in a row; the second load drops what was selected for the first.
    tab = { id: 7, url: EMPLOYER, status: "loading" };
    tabUpdated(7, { status: "loading" }, { ...tab, active: true });
    tab = { id: 7, url: EMPLOYER, status: "complete" };
    tabUpdated(7, { status: "complete" }, { ...tab, active: true });
    await settle();
    expect(selects()).toHaveLength(2);
  });

  it("does not react to a page loading in a tab nobody is looking at", async () => {
    mountApplicationHandoff();
    await settle();
    tabUpdated(
      8,
      { status: "loading" },
      { id: 8, url: EMPLOYER, status: "loading", active: false },
    );
    tabUpdated(
      8,
      { status: "complete" },
      { id: 8, url: EMPLOYER, status: "complete", active: false },
    );
    await settle();
    expect(selects()).toHaveLength(1);
  });

  it("waits quietly while the employer page is still opening", async () => {
    tab = { id: 9, url: "about:blank" };
    mountApplicationHandoff();
    await settle();
    expect(selects()).toHaveLength(0);
    expect(status()).toBe("");
    await switchTo({ id: 9, url: EMPLOYER });
    expect(selects()).toHaveLength(1);
  });

  it("tells a signed-out candidate to sign in, instead of a generic failure", async () => {
    send.mockImplementation(async (message) =>
      message.action === "application_pending_intent"
        ? { ok: true, reviewLink: LINK }
        : { ok: false, stage: "sign-in" },
    );
    mountApplicationHandoff();
    await settle();
    expect(status()).toContain("Sign in to ApplyDash in this panel");
    expect(status()).not.toContain("stopped at");
  });

  it("selects once the candidate has opened the extension on that page", async () => {
    tab = { id: 9 };
    mountApplicationHandoff();
    await settle();
    await switchTo({ id: 9, url: EMPLOYER });
    expect(selects()).toHaveLength(1);
  });

  it("does nothing when no application is waiting", async () => {
    pending = false;
    mountApplicationHandoff();
    await settle();
    await switchTo({ id: 8, url: EMPLOYER });
    expect(selects()).toHaveLength(0);
    expect(status()).toBe("");
  });

  it("leaves a link the candidate pasted alone", async () => {
    mountApplicationHandoff();
    const input = document.querySelector<HTMLInputElement>("input");
    if (input) input.value = `${LINK}&pasted=1`;
    await settle();
    expect(selects()).toHaveLength(0);
  });

  it("does not move the selection while a fill is running", async () => {
    let finish: (value: unknown) => void = () => undefined;
    send.mockImplementation(async (message) =>
      message.action === "application_pending_intent"
        ? { ok: true, reviewLink: LINK }
        : message.action === "application_native_apply"
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : { ok: true, resume: "generated" },
    );
    mountApplicationHandoff();
    await settle();
    document.querySelector<HTMLButtonElement>("[data-native-fill]")?.click();
    await settle();
    await switchTo({ id: 8, url: EMPLOYER });
    expect(selects()).toHaveLength(1);
    finish({ ok: true, result: "challenge_required" });
    await settle();
  });
});
