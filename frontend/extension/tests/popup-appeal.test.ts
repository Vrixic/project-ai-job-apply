// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { digest } = vi.hoisted(() => ({ digest: vi.fn() }));
vi.mock("../lib/contribution-owner-api", () => ({ appealEvidenceDigest: digest }));
const html = await readFile(
  resolve(dirname(fileURLToPath(import.meta.url)), "../static/popup.html"),
  "utf8",
);
const contributionId = "019d04cf-1f80-7000-8000-000000000010";
const status = {
  authenticated: true,
  configured: true,
  apiConfigured: true,
  refreshAvailable: true,
};
const receipt = {
  contributionId,
  state: "published",
  trust: { state: "taken_down", version: 3, appealed: false },
};
const baseline = { ok: true, status, receipts: [receipt] };
const outcome = () => document.querySelector("#owner-action-status")?.textContent;
function required<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing test control: ${selector}`);
  return value;
}
const form = () => required<HTMLFormElement>("#appeal-form");
const evidence = () => required<HTMLTextAreaElement>("#appeal-evidence");
function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent === text);
  expect(button).toBeDefined();
  if (!button) throw new Error("Missing test button");
  button.click();
}
async function idle() {
  await vi.waitFor(() =>
    expect(document.querySelector("main")?.getAttribute("aria-busy")).toBe("false"),
  );
}
async function setup() {
  const sendMessage = vi.fn(async (_message: unknown): Promise<object> => baseline);
  vi.stubGlobal("chrome", { runtime: { sendMessage, getManifest: () => ({ version: "0.2.0" }) } });
  await import("../entrypoints/popup");
  await idle();
  click("Appeal");
  evidence().value = "Disposable lifecycle test appeal";
  return sendMessage;
}
function submit() {
  form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("appeal submission feedback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    digest.mockReset().mockResolvedValue("a".repeat(64));
    document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const dialog = required<HTMLDialogElement>("#appeal-dialog");
    dialog.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    });
    dialog.close = vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    });
  });

  it("confirms recorded appeal and retains that result after a Trust refresh", async () => {
    const send = await setup();
    const accepted = {
      ...baseline,
      ownerAction: "ok",
      receipts: [{ ...receipt, trust: { state: "appeal_pending", version: 4, appealed: true } }],
    };
    send.mockResolvedValue(accepted);
    submit();
    await idle();
    expect(send).toHaveBeenLastCalledWith({
      action: "appeal",
      confirmed: true,
      contributionId,
      evidenceDigestSha256: "a".repeat(64),
    });
    expect(outcome()).toContain("Appeal recorded.");
    expect(evidence().value).toBe("");
    click("Refresh Trust");
    await idle();
    expect(outcome()).toContain("Appeal recorded.");
  });

  it("preserves conflict feedback instead of masking it with a successful refresh", async () => {
    const send = await setup();
    send.mockResolvedValueOnce({ ...baseline, ok: false, ownerAction: "version_conflict" });
    submit();
    await idle();
    expect(outcome()).toContain("server reported a conflict");
    expect(outcome()).not.toContain("record changed");
    send.mockResolvedValue({ ...baseline, ownerAction: "ok" });
    click("Refresh Trust");
    await idle();
    expect(outcome()).toContain("server reported a conflict");
    expect(document.querySelector("#contribution-list")?.textContent).toContain(
      "Trust: taken down",
    );
  });

  it("does not call a generic successful response confirmed without an appealed receipt", async () => {
    const send = await setup();
    send.mockResolvedValue({ ...baseline, ownerAction: "ok" });
    submit();
    await idle();
    expect(outcome()).toContain("submission was not confirmed");
  });

  it("shows digest failures inside the open dialog without sending anything", async () => {
    const send = await setup();
    digest.mockRejectedValue(new Error("synthetic digest failure"));
    submit();
    await idle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-appeal-error]")?.textContent).toContain(
      "Nothing was submitted",
    );
    expect(document.querySelector<HTMLDialogElement>("#appeal-dialog")?.open).toBe(true);
    expect(evidence().value).toBe("Disposable lifecycle test appeal");
    expect(form().querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });

  it("ignores duplicate submit while hashing or awaiting the response", async () => {
    const send = await setup();
    let hash!: (value: string) => void;
    let respond!: (value: object) => void;
    digest.mockReturnValue(
      new Promise<string>((resolve) => {
        hash = resolve;
      }),
    );
    send.mockReturnValueOnce(
      new Promise<object>((resolve) => {
        respond = resolve;
      }),
    );
    submit();
    submit();
    expect(digest).toHaveBeenCalledTimes(1);
    expect(form().querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    hash("a".repeat(64));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    submit();
    expect(digest).toHaveBeenCalledTimes(1);
    respond({ ...baseline, ok: false, ownerAction: "rejected" });
    await idle();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("clears retained appeal feedback when signing out", async () => {
    const send = await setup();
    send.mockResolvedValueOnce({ ...baseline, ok: false, ownerAction: "rejected" });
    submit();
    await idle();
    expect(outcome()).toContain("submission was not confirmed");
    send.mockResolvedValue({ ok: true, status: { ...status, authenticated: false }, receipts: [] });
    required<HTMLButtonElement>("#logout").click();
    await idle();
    expect(outcome()).toBe("");
  });
});
