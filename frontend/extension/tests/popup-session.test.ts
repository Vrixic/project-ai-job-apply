// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeSnapshot } from "../lib/job-capture";
import { createPendingIntent } from "../lib/pending-queue";

const popupHtml = await readFile(
  resolve(dirname(fileURLToPath(import.meta.url)), "../static/popup.html"),
  "utf8",
);

interface SessionStatus {
  apiConfigured: boolean;
  authenticated: boolean;
  configured: boolean;
  refreshAvailable: boolean;
}

const expiredSession: SessionStatus = {
  apiConfigured: true,
  authenticated: false,
  configured: true,
  refreshAvailable: true,
};

function button(id: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`#${id}`);
  if (!element) throw new Error("Missing generated fixture control");
  return element;
}

async function idle(): Promise<void> {
  await vi.waitFor(() => {
    expect(document.querySelector("main")?.getAttribute("aria-busy")).toBe("false");
  });
}

async function popup(status: SessionStatus) {
  const sendMessage = vi.fn(
    async (_message: unknown): Promise<{ ok: boolean; status: SessionStatus; error?: string }> => ({
      ok: true,
      status,
    }),
  );
  vi.stubGlobal("chrome", {
    runtime: { sendMessage, getManifest: () => ({ version: "0.2.0" }) },
  });
  await import("../entrypoints/popup");
  await idle();
  expect(sendMessage).toHaveBeenCalledWith({ action: "status" });
  return sendMessage;
}

describe("popup retained-session lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    document.body.innerHTML = new DOMParser().parseFromString(
      popupHtml,
      "text/html",
    ).body.innerHTML;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network forbidden in this test")));
  });

  it.each([
    [false, true, false, false, false],
    [true, true, true, false, false],
    [true, false, true, true, false],
    [false, false, false, true, true],
  ])(
    "offers only relevant controls for authenticated=%s and refreshAvailable=%s",
    async (authenticated, refreshAvailable, loginHidden, refreshHidden, logoutHidden) => {
      await popup({ ...expiredSession, authenticated, refreshAvailable });
      expect(button("login").hidden).toBe(loginHidden);
      expect(button("refresh").hidden).toBe(refreshHidden);
      expect(button("logout").hidden).toBe(logoutHidden);
      expect(button("contribute").disabled).toBe(true);
      expect(button("inspect").disabled).toBe(false);
      if (!authenticated && refreshAvailable) {
        expect(document.querySelector("#auth-status")?.textContent).toBe("Session expired");
      }
    },
  );

  it("keeps auth controls hidden when public identity configuration is absent", async () => {
    await popup({ ...expiredSession, configured: false, refreshAvailable: false });
    expect(button("login").hidden).toBe(true);
    expect(button("refresh").hidden).toBe(true);
    expect(button("logout").hidden).toBe(true);
    expect(button("inspect").disabled).toBe(false);
  });

  it("lets an expired retained session retry refresh without authorizing delivery", async () => {
    const sendMessage = await popup(expiredSession);
    expect(button("refresh").hidden).toBe(false);
    sendMessage.mockResolvedValueOnce({
      ok: true,
      status: { ...expiredSession, authenticated: true },
    });
    button("refresh").click();
    await idle();
    expect(sendMessage).toHaveBeenLastCalledWith({ action: "refresh" });
    expect(button("login").hidden).toBe(true);
    expect(button("logout").hidden).toBe(false);
    expect(button("contribute").disabled).toBe(true);
  });

  it("lets the owner clear an expired retained session and shows unconfirmed revocation honestly", async () => {
    const sendMessage = await popup(expiredSession);
    expect(button("logout").hidden).toBe(false);
    sendMessage.mockResolvedValueOnce({
      ok: false,
      status: { ...expiredSession, refreshAvailable: false },
      error: "Auth0 revocation could not be confirmed. Local extension data was cleared.",
    });
    button("logout").click();
    await idle();
    expect(sendMessage).toHaveBeenLastCalledWith({ action: "logout" });
    expect(document.querySelector("#detail")?.textContent).toBe(
      "Auth0 revocation could not be confirmed. Local extension data was cleared.",
    );
    expect(button("refresh").hidden).toBe(true);
    expect(button("logout").hidden).toBe(true);
    expect(button("inspect").disabled).toBe(false);
  });

  it("keeps retained-session clearing accessible after a failed refresh response", async () => {
    const sendMessage = await popup(expiredSession);
    expect(button("refresh").hidden).toBe(false);
    sendMessage.mockRejectedValueOnce(new Error("private-provider-error"));
    button("refresh").click();
    await idle();
    expect(button("logout").hidden).toBe(false);
    expect(button("logout").disabled).toBe(false);
    expect(button("contribute").disabled).toBe(true);
    expect(document.querySelector("#detail")?.textContent).toBe(
      "The extension did not respond. Close and reopen it, then try again.",
    );
    expect(document.body.textContent).not.toContain("private-provider-error");
  });

  it("shows unsupported optional text as unavailable and submits only visible selected fields", async () => {
    const status = { ...expiredSession, authenticated: true };
    const sendMessage = await popup(status);
    const capture = sanitizeSnapshot(
      {
        canonicalUrl: "https://jobs.lever.co/example/123",
        title: "Engineer",
        company: "Example Company",
        description: "<p>Synthetic threshold > 10</p>",
      },
      "lever",
      "lever-posting-v1",
    );
    expect(capture).toBeDefined();
    sendMessage.mockResolvedValueOnce({
      ok: true,
      status,
      ...{
        capture,
        delivery: {
          contribution: { ready: true, reason: "ready" },
          privateSave: { ready: true, reason: "ready" },
        },
      },
    });
    button("inspect").click();
    await idle();
    const description = document.querySelector<HTMLInputElement>('input[data-field="description"]');
    expect(description?.checked).toBe(false);
    expect(description?.disabled).toBe(true);
    const row = description?.closest(".field-row");
    expect(row?.getAttribute("data-field-kind")).toBe("unavailable");
    expect(row?.textContent).toContain("Not available for sharing");
    expect(document.body.textContent).not.toContain("Synthetic threshold");
    expect(document.querySelector("#selection-summary")?.textContent).toContain(
      "unavailable for sharing",
    );
    expect(button("contribute").disabled).toBe(false);
    button("contribute").click();
    await idle();
    expect(sendMessage).toHaveBeenLastCalledWith({
      action: "enqueue",
      approvedFields: ["company"],
      intent: "contribute",
    });
  });

  it("shows literal comparisons as selected description text and enqueues that visible field", async () => {
    const status = { ...expiredSession, authenticated: true };
    const sendMessage = await popup(status);
    const publicDescription = "Synthetic threshold < 10 and > 5";
    const capture = sanitizeSnapshot(
      {
        canonicalUrl: "https://jobs.ashbyhq.com/example/posting-42",
        title: "Engineer",
        description: publicDescription,
      },
      "ashby",
      "ashby-job-board-v1",
    );
    sendMessage.mockResolvedValueOnce({
      ok: true,
      status,
      ...{ capture, delivery: { contribution: { ready: true, reason: "ready" } } },
    });
    button("inspect").click();
    await idle();
    const description = document.querySelector<HTMLInputElement>('input[data-field="description"]');
    expect(description?.checked).toBe(true);
    expect(description?.disabled).toBe(false);
    expect(description?.closest(".field-row")?.textContent).toContain(publicDescription);
    expect(button("contribute").disabled).toBe(false);
    button("contribute").click();
    await idle();
    expect(sendMessage).toHaveBeenLastCalledWith({
      action: "enqueue",
      approvedFields: ["description"],
      intent: "contribute",
    });
  });

  it.each([18_185, 50_000])(
    "keeps the complete %i-character value through expand, collapse and enqueue",
    async (length) => {
      const status = { ...expiredSession, authenticated: true };
      const sendMessage = await popup(status);
      const tail = " COMPLETE SYNTHETIC TAIL >= 5";
      const publicDescription = `${"x".repeat(length - tail.length)}${tail}`;
      const capture = sanitizeSnapshot(
        {
          canonicalUrl: "https://jobs.ashbyhq.com/example/posting-42",
          title: "Engineer",
          description: publicDescription,
        },
        "ashby",
        "ashby-job-board-v1",
      );
      if (!capture) throw new Error("Expected a sanitized capture");
      sendMessage.mockResolvedValueOnce({
        ok: true,
        status,
        ...{ capture, delivery: { contribution: { ready: true, reason: "ready" } } },
      });
      button("inspect").click();
      await idle();
      const checkbox = document.querySelector<HTMLInputElement>('input[data-field="description"]');
      const row = checkbox?.closest(".field-row");
      const value = row?.querySelector<HTMLElement>(".field-value");
      const toggle = row?.querySelector<HTMLButtonElement>(
        'button[data-expand-field="description"]',
      );
      expect(checkbox?.checked).toBe(true);
      expect(value?.textContent).toBe(publicDescription);
      expect(value?.classList.contains("is-collapsed")).toBe(true);
      toggle?.click();
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      expect(value?.textContent).toBe(publicDescription);
      expect(value?.classList.contains("is-collapsed")).toBe(false);
      toggle?.click();
      expect(toggle?.getAttribute("aria-expanded")).toBe("false");
      expect(value?.textContent).toBe(publicDescription);
      button("contribute").click();
      await idle();
      expect(sendMessage).toHaveBeenLastCalledWith({
        action: "enqueue",
        approvedFields: ["description"],
        intent: "contribute",
      });
      const pending = createPendingIntent({
        approvedFields: ["description"],
        capture,
        identityFence: "synthetic-account-fence",
        intent: "contribute",
        retentionMilliseconds: 86_400_000,
      });
      expect(pending.capture.description).toBe(publicDescription);
      expect(JSON.parse(JSON.stringify(pending)).capture.description).toBe(publicDescription);
    },
  );

  it("keeps a wire-oversized full preview editable after the background refuses delivery", async () => {
    const status = { ...expiredSession, authenticated: true };
    const sendMessage = await popup(status);
    const publicDescription = "漢".repeat(50_000);
    const capture = sanitizeSnapshot(
      {
        canonicalUrl: "https://jobs.ashbyhq.com/example/posting-42",
        title: "Engineer",
        description: publicDescription,
      },
      "ashby",
      "ashby-job-board-v1",
    );
    sendMessage.mockResolvedValueOnce({
      ok: true,
      status,
      ...{ capture, delivery: { contribution: { ready: true, reason: "ready" } } },
    });
    button("inspect").click();
    await idle();
    const error =
      "Selected fields exceed the 64 KiB delivery limit. Deselect Description or another optional field, then add the job again. No shortened text was shared.";
    sendMessage.mockResolvedValueOnce({ ok: false, status, error });
    button("contribute").click();
    await idle();
    expect(document.querySelector("#detail")?.textContent).toBe(error);
    const checkbox = document.querySelector<HTMLInputElement>('input[data-field="description"]');
    expect(checkbox?.closest(".field-row")?.querySelector(".field-value")?.textContent).toBe(
      publicDescription,
    );
    expect(checkbox?.disabled).toBe(false);
    checkbox?.click();
    expect(checkbox?.checked).toBe(false);
    expect(button("contribute").disabled).toBe(false);
    button("contribute").click();
    await idle();
    expect(sendMessage).toHaveBeenLastCalledWith({
      action: "enqueue",
      approvedFields: [],
      intent: "contribute",
    });
  });

  it.each([
    ["too_long", "Description exceeds the 50,000-character limit."],
    ["source_too_large", "Description source exceeds the safe capture limit."],
  ] as const)(
    "explains %s without exposing or enqueueing a shortened description",
    async (reason, message) => {
      const status = { ...expiredSession, authenticated: true };
      const sendMessage = await popup(status);
      const capture = sanitizeSnapshot(
        {
          canonicalUrl: "https://jobs.ashbyhq.com/example/posting-42",
          title: "Engineer",
          descriptionUnavailableReason: reason,
        },
        "ashby",
        "ashby-job-board-v1",
      );
      sendMessage.mockResolvedValueOnce({
        ok: true,
        status,
        ...{ capture, delivery: { contribution: { ready: true, reason: "ready" } } },
      });
      button("inspect").click();
      await idle();
      const checkbox = document.querySelector<HTMLInputElement>('input[data-field="description"]');
      expect(checkbox?.disabled).toBe(true);
      expect(checkbox?.checked).toBe(false);
      expect(checkbox?.closest(".field-row")?.textContent).toContain(message);
      expect(checkbox?.closest(".field-row")?.textContent).toContain(
        "No shortened description will be shared.",
      );
      button("contribute").click();
      await idle();
      expect(sendMessage).toHaveBeenLastCalledWith({
        action: "enqueue",
        approvedFields: [],
        intent: "contribute",
      });
    },
  );
});
