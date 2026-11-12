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

  it.each([
    [
      "a recorded page run that did not confirm",
      {
        ok: true,
        outcome: "review_required",
        result: "unrecognized_response",
        pageStage: "fill:salary Error",
      },
      "Not submitted by the extension, or not confirmed.",
      " (page run: unrecognized_response, at fill:salary Error)",
    ],
    [
      "a page that was not ready before anything was filled",
      { ok: true, outcome: "review_required", result: "precondition_failed", pageStage: "root" },
      "Nothing was submitted: the employer page was not ready.",
      " (page run: precondition_failed, at root)",
    ],
    [
      "a run the extension could not record",
      { ok: false, outcome: "unknown", stage: "attempt-recheck" },
      "The submission outcome is uncertain.",
      " (stopped at: attempt-recheck)",
    ],
  ])("tells the candidate where an Apply stopped: %s", async (_name, response, lead, detail) => {
    send.mockImplementation(async (message) =>
      message.action === "application_native_apply" ? response : { ok: true },
    );
    control<HTMLInputElement>("input").value = LINK;
    control<HTMLButtonElement>("[data-native-apply]").click();
    await flush();
    const text = control("[data-handoff-status]").textContent ?? "";
    expect(text).toContain(lead);
    expect(text).toContain(detail);
  });

  it.each([
    [1, "1 required question on the employer page still needs your own answer. Answer it"],
    [3, "3 required questions on the employer page still need your own answer. Answer them"],
    [0, "A required question on the employer page still needs your own answer. Answer it"],
  ])(
    "says plainly that nothing was recorded when the page is not ready (%s)",
    async (needs, sentence) => {
      send.mockImplementation(async (message) =>
        message.action === "application_native_apply"
          ? { ok: false, outcome: "review_required", stage: "page-not-ready", needs }
          : { ok: true },
      );
      control<HTMLInputElement>("input").value = LINK;
      control<HTMLButtonElement>("[data-native-apply]").click();
      await flush();
      const text = control("[data-handoff-status]").textContent ?? "";
      expect(text).toContain("Nothing was submitted and nothing was recorded.");
      expect(text).toContain(sentence);
      expect(text).toContain("press Fill and submit again.");
      expect(text).not.toContain("stopped at");
      // No reconnect, no second press, nothing to reconcile.
      expect(send).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "application_native_select" }),
      );
    },
  );

  it("names the questions the candidate still has to answer, in the employer's words, as plain text", async () => {
    send.mockImplementation(async (message) =>
      message.action === "application_native_apply"
        ? {
            ok: false,
            outcome: "review_required",
            stage: "page-not-ready",
            needs: 7,
            waiting: ["Why do you want to work here?", "<img src=x onerror=alert(1)>"],
          }
        : { ok: true },
    );
    control<HTMLInputElement>("input").value = LINK;
    control<HTMLButtonElement>("[data-native-apply]").click();
    await flush();
    const status = control("[data-handoff-status]");
    expect(status.textContent).toContain(
      '7 required questions on the employer page still need your own answer. Waiting for you: "Why do you want to work here?"; "<img src=x onerror=alert(1)>" and 5 more.',
    );
    expect(status.querySelector("img")).toBeNull();
  });

  describe("required open questions the answer engine can write", () => {
    const NAME = "What interests you about this role?";
    const refusal = (extra: Record<string, unknown> = {}) => ({
      ok: false,
      outcome: "review_required",
      stage: "page-not-ready",
      needs: 1,
      draftable: 1,
      waiting: [NAME],
      ...extra,
    });
    const settle = async () => {
      for (let i = 0; i < 8; i++) await flush();
    };
    const actions = () =>
      send.mock.calls
        .map(([message]) => message as { action: string; fillOnly?: boolean })
        .filter((message) => message.action.startsWith("application_native_"));
    const script = (...replies: unknown[]) => {
      const queue = [...replies];
      send.mockImplementation(async (message) =>
        message.action === "application_native_apply" ||
        message.action === "application_native_draft"
          ? queue.shift()
          : { ok: true },
      );
    };
    async function press() {
      control<HTMLInputElement>("input").value = LINK;
      control<HTMLButtonElement>("[data-native-apply]").click();
      await settle();
    }
    const choice = () => document.querySelector<HTMLElement>("[data-draft-choice]");
    const text = () => control("[data-handoff-status]").textContent ?? "";

    it("asks instead of refusing, in the employer's words, before anything is filled", async () => {
      script(refusal());
      await press();
      expect(choice()?.textContent).toContain(`"${NAME}"`);
      expect(choice()?.textContent).toContain("Should AI write it from your profile?");
      expect(choice()?.querySelector("[data-draft-note]")).toBeNull();
      expect(text()).not.toContain("Nothing was submitted and nothing was recorded");
      expect(actions().map((message) => message.action)).toEqual(["application_native_apply"]);
    });

    it("tells the candidate when the employer asked for an answer written without AI, as text", async () => {
      script(refusal({ draftNoAi: true, waiting: ["<img src=x onerror=alert(1)>"] }));
      await press();
      expect(choice()?.querySelector("[data-draft-note]")?.textContent).toContain(
        "without AI. You decide.",
      );
      expect(choice()?.querySelector("img")).toBeNull();
    });

    it("writes the answers, then fills and submits, when the candidate says yes", async () => {
      script(
        refusal(),
        { ok: true, drafted: 1, declined: 0, failed: 0 },
        { ok: true, outcome: "confirmed" },
      );
      await press();
      control<HTMLButtonElement>("[data-draft-yes]").click();
      await settle();
      expect(actions()).toEqual([
        { action: "application_native_apply", reviewLink: LINK },
        { action: "application_native_draft", reviewLink: LINK },
        { action: "application_native_apply", reviewLink: LINK },
      ]);
      expect(text()).toContain("The employer confirmed submission.");
      expect(choice()).toBeNull();
    });

    it("fills the rest and stops for the candidate when they say no, and never asks the engine", async () => {
      script(refusal(), {
        ok: true,
        outcome: "review_required",
        result: "challenge_required",
        notes: ["needs:1"],
      });
      await press();
      control<HTMLButtonElement>("[data-draft-no]").click();
      await settle();
      expect(actions()).toEqual([
        { action: "application_native_apply", reviewLink: LINK },
        {
          action: "application_native_apply",
          reviewLink: LINK,
          fillOnly: true,
          skipDraftOffer: true,
        },
      ]);
      expect(text()).toContain("Filled for your review. Nothing was submitted.");
      expect(text()).toContain("1 required question still needs you.");
    });

    it("does not submit when the engine can write only some of the questions, and says so", async () => {
      script(
        refusal({ needs: 3, draftable: 1 }),
        { ok: true, drafted: 1, declined: 0, failed: 0 },
        { ok: true, outcome: "review_required", result: "challenge_required" },
      );
      await press();
      expect(choice()?.textContent).toContain("AI can write 1 of them from your profile");
      expect(choice()?.querySelector("[data-draft-yes]")?.textContent).toContain(
        "fill for my review",
      );
      control<HTMLButtonElement>("[data-draft-yes]").click();
      await settle();
      expect(actions().at(-1)).toEqual({
        action: "application_native_apply",
        reviewLink: LINK,
        fillOnly: true,
        skipDraftOffer: true,
      });
      expect(text()).toContain("Answers were written for 1 question: read it before you submit.");
    });

    it.each([
      [
        "the engine declined every question",
        { ok: true, drafted: 0, declined: 1, failed: 0 },
        "No answer could be written",
      ],
      ["the drafting step failed", { ok: false, stage: "draft-page" }, "(stopped at: draft-page)"],
    ])("falls back to a fill for review when %s", async (_name, drafted, sentence) => {
      script(refusal(), drafted, {
        ok: true,
        outcome: "review_required",
        result: "challenge_required",
      });
      await press();
      control<HTMLButtonElement>("[data-draft-yes]").click();
      await settle();
      expect(actions().at(-1)).toMatchObject({ fillOnly: true });
      expect(text()).toContain(sentence);
      expect(text()).toContain("Nothing was submitted.");
    });

    it("withdraws the question on Clear: nothing is filled, drafted or submitted, and the transfer is cleared", async () => {
      script(refusal());
      await press();
      control<HTMLButtonElement>("[data-native-clear]").click();
      await settle();
      expect(choice()).toBeNull();
      // Clear also gives up the selected page and resume, and says so.
      expect(text()).toContain("Approved file transfer cleared.");
      expect(actions().filter((message) => message.action !== "application_native_clear")).toEqual([
        { action: "application_native_apply", reviewLink: LINK },
      ]);
    });

    describe("on Fill for my review", () => {
      async function pressFill() {
        control<HTMLInputElement>("input").value = LINK;
        control<HTMLButtonElement>("[data-native-fill]").click();
        await settle();
      }
      const filled = { ok: true, outcome: "review_required", result: "challenge_required" };
      const review = { action: "application_native_apply", reviewLink: LINK, fillOnly: true };

      it("asks the same question, with wording that never mentions submitting", async () => {
        script(refusal());
        await pressFill();
        expect(choice()?.textContent).toContain(`"${NAME}"`);
        expect(choice()?.querySelector("[data-draft-yes]")?.textContent).toBe(
          "Write with AI, then fill for my review",
        );
        expect(choice()?.querySelector("[data-draft-no]")?.textContent).toBe(
          "Fill the rest, I will answer myself",
        );
        expect(actions()).toEqual([review]);
      });

      it("writes the answers and then fills for review, never submitting, when they say yes", async () => {
        script(refusal(), { ok: true, drafted: 1, declined: 0, failed: 0 }, filled);
        await pressFill();
        control<HTMLButtonElement>("[data-draft-yes]").click();
        await settle();
        expect(actions()).toEqual([
          review,
          { action: "application_native_draft", reviewLink: LINK },
          { ...review, skipDraftOffer: true },
        ]);
        expect(text()).toContain("Filled for your review. Nothing was submitted.");
        expect(text()).toContain("Answers were written for 1 question: read it before you submit.");
      });

      it("fills the rest without asking the engine when they say no", async () => {
        script(refusal(), filled);
        await pressFill();
        control<HTMLButtonElement>("[data-draft-no]").click();
        await settle();
        expect(actions()).toEqual([review, { ...review, skipDraftOffer: true }]);
        expect(text()).toContain("Filled for your review. Nothing was submitted.");
      });
    });

    it("keeps the plain refusal when the engine can write none of the waiting questions", async () => {
      script(refusal({ draftable: 0 }));
      await press();
      expect(choice()).toBeNull();
      expect(text()).toContain("Nothing was submitted and nothing was recorded.");
    });
  });

  it("keeps the review link through a token refresh, and drops it when the account changes", async () => {
    const link = () => control<HTMLInputElement>("input").value;
    control<HTMLInputElement>("input").value = LINK;
    storageListener(
      {
        auth0Session: {
          oldValue: { accessToken: "old", identityFence: "F" },
          newValue: { accessToken: "new", identityFence: "F" },
        },
      },
      "session",
    );
    await flush();
    expect(link()).toBe(LINK);
    expect(send).not.toHaveBeenCalledWith({ action: "application_handoff_clear" });
    storageListener(
      {
        auth0Session: {
          oldValue: { identityFence: "F" },
          newValue: { identityFence: "OTHER" },
        },
      },
      "session",
    );
    await flush();
    expect(link()).toBe("");
    expect(send).toHaveBeenCalledWith({ action: "application_handoff_clear" });
  });

  it("reaches the worker every 20 seconds while the panel is open, and says nothing about it", async () => {
    await flush();
    const reads = () =>
      send.mock.calls.filter(([message]) => message.action === "application_pending_intent").length;
    const before = reads();
    const text = control("[data-handoff-status]").textContent;
    await vi.advanceTimersByTimeAsync(19_000);
    expect(reads()).toBe(before);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(reads()).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(reads()).toBe(before + 3);
    expect(control("[data-handoff-status]").textContent).toBe(text);
  });

  describe("when the extension lost the selected page", () => {
    const lost = { ok: false, outcome: "unavailable", stage: "selection-or-resume:none" };
    const applyCalls = () =>
      send.mock.calls.filter(([message]) => message.action === "application_native_apply");

    it.each([
      ["fill", "[data-native-fill]", true, "Filled for your review"],
      ["apply", "[data-native-apply]", false, "employer confirmed submission"],
    ])(
      "selects the same page again once and carries on with the %s",
      async (_name, selector, fillOnly, text) => {
        let applies = 0;
        send.mockImplementation(async (message) => {
          if (message.action !== "application_native_apply") return { ok: true };
          applies++;
          if (applies === 1) return lost;
          return fillOnly
            ? { ok: true, outcome: "review_required", result: "challenge_required" }
            : { ok: true, outcome: "confirmed" };
        });
        control<HTMLInputElement>("input").value = LINK;
        control<HTMLButtonElement>(selector).click();
        await flush();
        const actions = send.mock.calls
          .map(([message]) => message.action as string)
          .filter((name) => name.startsWith("application_native_"));
        expect(actions).toEqual([
          "application_native_apply",
          "application_native_select",
          "application_native_apply",
        ]);
        expect(send).toHaveBeenCalledWith({
          action: "application_native_select",
          reviewLink: LINK,
        });
        expect(applyCalls()).toHaveLength(2);
        expect(applyCalls()[1]?.[0]).toEqual(applyCalls()[0]?.[0]);
        expect(control("[data-handoff-status]").textContent).toContain(text);
        expect(control("[data-handoff-status]").textContent).not.toContain("stopped at");
      },
    );

    it("tries once and says where it stopped when the page cannot be selected again", async () => {
      send.mockImplementation(async (message) =>
        message.action === "application_native_apply"
          ? lost
          : message.action === "application_native_select"
            ? { ok: false, stage: "employer-tab" }
            : { ok: true },
      );
      control<HTMLInputElement>("input").value = LINK;
      control<HTMLButtonElement>("[data-native-apply]").click();
      await flush();
      expect(applyCalls()).toHaveLength(1);
      expect(control("[data-handoff-status]").textContent).toContain(
        "(stopped at: reconnect>employer-tab)",
      );
    });

    it("does not select again, or submit twice, when the refusal is anything else", async () => {
      send.mockImplementation(async (message) =>
        message.action === "application_native_apply"
          ? { ok: false, outcome: "unavailable", stage: "selection-or-resume:consumed" }
          : { ok: true },
      );
      control<HTMLInputElement>("input").value = LINK;
      control<HTMLButtonElement>("[data-native-apply]").click();
      await flush();
      expect(send).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "application_native_select" }),
      );
      expect(applyCalls()).toHaveLength(1);
      expect(control("[data-handoff-status]").textContent).toContain(
        "(stopped at: selection-or-resume:consumed)",
      );
    });

    it("never repeats a second loss: one reconnect per press", async () => {
      send.mockImplementation(async (message) =>
        message.action === "application_native_apply" ? lost : { ok: true },
      );
      control<HTMLInputElement>("input").value = LINK;
      control<HTMLButtonElement>("[data-native-fill]").click();
      await flush();
      expect(applyCalls()).toHaveLength(2);
      expect(
        send.mock.calls.filter(([message]) => message.action === "application_native_select"),
      ).toHaveLength(1);
      expect(control("[data-handoff-status]").textContent).toContain(
        "(stopped at: selection-or-resume:none)",
      );
    });
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
              "near:job.salary_expectation",
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
    expect(text).toContain(
      "Salary: none of the ranges held your salary, so the closest one was chosen: check it.",
    );
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
