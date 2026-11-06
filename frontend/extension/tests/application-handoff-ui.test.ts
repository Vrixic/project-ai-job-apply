// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvedHandoff } from "../lib/application-handoff";
import { handoffFixture, LINK, WEB } from "./application-handoff-fixture";

vi.mock("../lib/config", () => ({
  extensionConfiguration: {
    applicationHandoffWebOrigin: "https://candidate.example",
    applicationExecutionEnabled: true,
  },
}));

import { mountApplicationHandoff } from "../lib/application-handoff-ui";

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const clipboard = vi.fn(async () => undefined);
let send: ReturnType<typeof vi.fn>;
let storageListener: (changes: Record<string, unknown>, area: string) => void;
let snapshot: ReturnType<typeof approvedHandoff> & {
  title: string;
  company: string;
  reviewLink: string;
};
const domListeners: {
  target: EventTarget;
  type: string;
  listener: EventListenerOrEventListenerObject;
}[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  snapshot = {
    ...approvedHandoff(handoffFixture().application, Date.now()),
    title: "<img src=x onerror=alert(1)>",
    company: "Synthetic",
    reviewLink: LINK,
  };
  send = vi.fn(async (message) =>
    message.action === "application_handoff_read"
      ? { ok: true, snapshotId: "00000000-0000-4000-8000-000000000001", handoff: snapshot }
      : message.action === "application_handoff_copy"
        ? { ok: true, value: "No" }
        : { ok: true },
  );
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: send },
    storage: {
      onChanged: {
        addListener: (listener: typeof storageListener) => {
          storageListener = listener;
        },
      },
    },
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  clipboard.mockClear();
  document.body.innerHTML =
    '<button id="logout">Logout</button><section id="application-handoff" hidden><input><button data-handoff-load>Load</button><button data-handoff-form>Copy structure</button><button data-handoff-clear>Clear</button><button data-native-fill hidden>Fill</button><button data-native-apply hidden>Apply</button><button data-native-clear hidden>Clear files</button><div data-handoff-content></div><div data-handoff-status></div></section>';
  for (const target of [window, document]) {
    const original = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions,
    ) => {
      domListeners.push({ target, type, listener });
      original(type, listener, options);
    }) as typeof target.addEventListener);
  }
  mountApplicationHandoff();
});
afterEach(() => {
  for (const entry of domListeners.splice(0))
    entry.target.removeEventListener(entry.type, entry.listener);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});
function control<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing ${selector}`);
  return value;
}
async function load() {
  control<HTMLInputElement>("#application-handoff input").value = LINK;
  control<HTMLButtonElement>("[data-handoff-load]").click();
  await flush();
}
function confirm() {
  const checkbox = control<HTMLInputElement>('input[type="checkbox"]');
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
}
function copyButton() {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Copy authorization.us_authorized",
  );
  if (!button) throw new Error("Missing restricted answer");
  return button;
}
describe("manual handoff UI", () => {
  it("fills for the candidate's review without asking to submit", async () => {
    send.mockImplementation(async (message) =>
      message.action === "application_native_apply"
        ? { ok: true, outcome: "review_required", result: "challenge_required" }
        : { ok: true },
    );
    control<HTMLInputElement>("input").value = LINK;
    const fill = control<HTMLButtonElement>("[data-native-fill]");
    expect(fill.hidden).toBe(false);
    fill.click();
    await flush();
    expect(send).toHaveBeenCalledWith({
      action: "application_native_apply",
      reviewLink: LINK,
      fillOnly: true,
    });
    expect(control("[data-handoff-status]").textContent).toContain("Filled for your review");
  });

  it("says it is filling while the fill runs, and then how it ended", async () => {
    let finish: (value: unknown) => void = () => undefined;
    send.mockImplementation(async (message) =>
      message.action === "application_native_apply"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { ok: true },
    );
    control<HTMLInputElement>("input").value = LINK;
    control<HTMLButtonElement>("[data-native-fill]").click();
    await flush();
    expect(control("[data-handoff-status]").textContent).toContain("Filling in your application");
    finish({ ok: true, outcome: "review_required", result: "challenge_required" });
    await flush();
    expect(control("[data-handoff-status]").textContent).toContain("Filled for your review");
  });

  it("says what the fill left to the candidate", async () => {
    send.mockImplementation(async (message) =>
      message.action === "application_native_apply"
        ? {
            ok: true,
            outcome: "review_required",
            result: "challenge_required",
            notes: [
              "other:education.school",
              "empty:education.degree",
              "needs:3",
              "other:unknown.key",
              "needs:x",
            ],
          }
        : { ok: true },
    );
    control<HTMLInputElement>("input").value = LINK;
    control<HTMLButtonElement>("[data-native-fill]").click();
    await flush();
    const text = control("[data-handoff-status]").textContent ?? "";
    expect(text).toContain("School was not in the board's list, so Other was chosen: check it.");
    expect(text).toContain("Degree has no saved value: add it in your ApplyDash profile.");
    expect(text).toContain("3 required questions still need you.");
    expect(text).not.toContain("unknown.key");
    expect(text).not.toContain("needs:x");
  });

  it("allows Clear during a pending Apply and blocks duplicate Apply", async () => {
    let finish: (value: unknown) => void = () => undefined;
    send.mockImplementation(async (message) =>
      message.action === "application_native_apply"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { ok: true },
    );
    control<HTMLInputElement>("input").value = LINK;
    const apply = control<HTMLButtonElement>("[data-native-apply]");
    expect(apply.hidden).toBe(false);
    apply.click();
    apply.click();
    await flush();
    expect(
      send.mock.calls.filter(([message]) => message.action === "application_native_apply"),
    ).toHaveLength(1);
    control<HTMLButtonElement>("[data-native-clear]").click();
    await flush();
    expect(send).toHaveBeenCalledWith({ action: "application_native_clear" });
    expect(control("[data-handoff-status]").textContent).toContain("If Apply had started");
    finish({ ok: false, outcome: "unknown" });
    await flush();
    expect(control("[data-handoff-status]").textContent).toContain("do not submit again");
    expect(apply.disabled).toBe(false);
  });

  it.each([true, false])(
    "shows confirmed copy only for a positive owning acknowledgement (%s)",
    async (ok) => {
      send.mockResolvedValue({ ok, outcome: "confirmed" });
      control<HTMLInputElement>("input").value = LINK;
      control<HTMLButtonElement>("[data-native-apply]").click();
      await flush();
      expect(
        control("[data-handoff-status]").textContent?.includes("employer confirmed submission"),
      ).toBe(ok);
    },
  );
  it("does not select, fill or submit until Apply has set the review link", async () => {
    for (const selector of ["[data-native-fill]", "[data-native-apply]"]) {
      control<HTMLButtonElement>(selector).click();
      await flush();
    }
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "application_native_apply" }),
    );
    expect(control("[data-handoff-status]").textContent).toContain("Press Apply on the website");
  });
  it("copies explicit structure only and suppresses a late result after clear", async () => {
    mountApplicationHandoff();
    control<HTMLInputElement>("input").value = LINK;
    send.mockImplementation(async (message) =>
      message.action === "application_form_capture"
        ? { ok: true, observedForm: "synthetic structure" }
        : { ok: true },
    );
    control<HTMLButtonElement>("[data-handoff-form]").click();
    await flush();
    expect(clipboard).toHaveBeenCalledWith("synthetic structure");
    expect(send).toHaveBeenCalledWith({ action: "application_form_capture", reviewLink: LINK });
    clipboard.mockClear();
    let finish: (value: unknown) => void = () => undefined;
    send.mockImplementation(async (message) =>
      message.action === "application_form_capture"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { ok: true },
    );
    control<HTMLInputElement>("input").value = LINK;
    control<HTMLButtonElement>("[data-handoff-form]").click();
    await flush();
    control<HTMLButtonElement>("[data-handoff-clear]").click();
    finish({ ok: true, observedForm: "late" });
    await flush();
    expect(clipboard).not.toHaveBeenCalled();
  });
  it("clears sensitive preview after the browser refuses clipboard access", async () => {
    await load();
    confirm();
    clipboard.mockRejectedValueOnce(new DOMException("Not focused", "NotAllowedError"));
    copyButton().click();
    await flush();
    expect(control("[data-handoff-content]").childElementCount).toBe(0);
  });
  it("requires fresh sensitive-answer confirmation for every copy, preserves No, and renders inert text", async () => {
    const restricted = snapshot.fields[1];
    if (!restricted) throw new Error("Missing restricted field");
    restricted.context = "<img src=x onerror=alert(1)>";
    await load();
    expect(document.querySelector("img")).toBeNull();
    expect(document.body.textContent).toContain(snapshot.title);
    expect(document.body.textContent).toContain(`Saved answer context: ${restricted.context}`);
    expect(control<HTMLAnchorElement>("[data-handoff-content] a").origin).toBe(WEB);
    expect(copyButton().disabled).toBe(true);
    copyButton().click();
    await flush();
    expect(clipboard).not.toHaveBeenCalled();
    confirm();
    copyButton().click();
    await flush();
    expect(clipboard).toHaveBeenCalledExactlyOnceWith("No");
    expect(copyButton().disabled).toBe(true);
    expect(control<HTMLInputElement>('input[type="checkbox"]').checked).toBe(false);
  });
  it.each(["clear", "logout", "identity", "expiry"])("discards the preview on %s", async (kind) => {
    await load();
    if (kind === "clear") control<HTMLButtonElement>("[data-handoff-clear]").click();
    if (kind === "logout") control<HTMLButtonElement>("#logout").click();
    if (kind === "identity") storageListener({ auth0Session: {} }, "session");
    if (kind === "expiry") await vi.advanceTimersByTimeAsync(60_001);
    expect(control("[data-handoff-content]").childElementCount).toBe(0);
    expect(clipboard).not.toHaveBeenCalled();
  });
  it.each(["changed", "clear", "unchecked"])("refuses a late copy after %s", async (kind) => {
    await load();
    let finish: (value: unknown) => void = () => {
      throw new Error("Not pending");
    };
    send.mockImplementation(async (message) =>
      message.action === "application_handoff_copy"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { ok: true },
    );
    confirm();
    copyButton().click();
    await flush();
    if (kind === "clear") control<HTMLButtonElement>("[data-handoff-clear]").click();
    if (kind === "unchecked") control<HTMLInputElement>('input[type="checkbox"]').checked = false;
    finish({ ok: true, value: kind === "changed" ? "Yes" : "No" });
    await flush();
    expect(clipboard).not.toHaveBeenCalled();
    expect(control("[data-handoff-content]").childElementCount).toBe(0);
  });
});
