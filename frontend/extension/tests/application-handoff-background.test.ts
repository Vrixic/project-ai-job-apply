import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPLOYER, handoffFixture, LINK, WEB } from "./application-handoff-fixture";

vi.mock("../lib/protocol", () => ({
  authenticatedApiSession: vi.fn(async () => ({
    accessToken: "synthetic-token",
    identityFence: "a".repeat(43),
  })),
  authenticationStatus: vi.fn(async () => ({
    configured: true,
    authenticated: true,
    apiConfigured: true,
    refreshAvailable: false,
  })),
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
}));
interface Result {
  ok: boolean;
  snapshotId?: string;
  value?: string;
  handoff?: unknown;
  observedForm?: string;
}
async function background(enabled = true) {
  vi.stubGlobal("__APPLICATION_HANDOFF_WEB_ORIGIN__", enabled ? WEB : "");
  vi.stubGlobal("__EXTENSION_API_ORIGIN__", "https://api.example");
  const local = new Map<string, unknown>();
  const session = new Map<string, unknown>();
  const area = (records: Map<string, unknown>) => ({
    get: vi.fn(async (key: string) => ({ [key]: records.get(key) })),
    set: vi.fn(async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) records.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      records.delete(key);
    }),
    setAccessLevel: vi.fn(async () => undefined),
  });
  let listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (result: Result) => void,
  ) => boolean;
  const browser = {
    scripting: {
      executeScript: vi.fn(async () => [
        {
          result: {
            challengePresent: false,
            fields: [
              {
                ref: "f0",
                name: "authorization",
                label: "Work authorization",
                type: "select",
                required: true,
                options: ["Yes", "No"],
              },
            ],
          },
        },
      ]),
    },
    runtime: {
      id: "synthetic-extension",
      getURL: (path: string) => `chrome-extension://synthetic-extension/${path}`,
      getManifest: () => ({ version: "0.2.0" }),
      onMessage: {
        addListener: (value: typeof listener) => {
          listener = value;
        },
      },
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
    },
    storage: { local: area(local), session: area(session) },
    windows: { getLastFocused: vi.fn(async () => ({ id: 11, type: "normal" })) },
    tabs: {
      query: vi.fn(async () => [{ id: 7, url: EMPLOYER }]),
      get: vi.fn(async () => ({ id: 7, url: EMPLOYER })),
    },
    alarms: { create: vi.fn(), clear: vi.fn(async () => true), onAlarm: { addListener: vi.fn() } },
  };
  vi.stubGlobal("chrome", browser);
  const fixture = handoffFixture();
  const fetcher = vi.fn(
    async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(url).includes("/authorization?")
            ? fixture.proof
            : String(url).includes("/v1/jobs/")
              ? fixture.job
              : fixture.application,
        ),
        { headers: { "content-type": "application/json", "cache-control": "no-store" } },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  await import("../entrypoints/background");
  return {
    browser,
    fixture,
    fetcher,
    local,
    session,
    send: (
      message: unknown,
      sender: chrome.runtime.MessageSender = {
        id: browser.runtime.id,
        url: browser.runtime.getURL("popup.html"),
      },
    ) => new Promise<Result>((resolve) => listener(message, sender, resolve)),
  };
}
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const api = await import("../lib/protocol");
  vi.mocked(api.authenticatedApiSession)
    .mockReset()
    .mockResolvedValue({ accessToken: "synthetic-token", identityFence: "a".repeat(43) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("manual handoff background trust boundary", () => {
  it("captures only bounded structure after owner/job reads without requiring approval or persisting a queue", async () => {
    const worker = await background();
    worker.fixture.application.status = "review_required";
    worker.fixture.application.currentAction = "review_and_approve";
    const result = await worker.send({ action: "application_form_capture", reviewLink: LINK });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.observedForm ?? "{}")).toMatchObject({
      schema: "application-observed-form.v1",
      applicationId: worker.fixture.application.id,
      destination: EMPLOYER,
    });
    expect(result.observedForm).not.toContain("synthetic@example.test");
    expect(
      worker.fetcher.mock.calls.filter(([url]) =>
        /\/v1\/(?:applications|jobs)\//u.test(String(url)),
      ),
    ).toHaveLength(3);
    expect(worker.local.size + worker.session.size).toBe(0);
  });
  it("captures from the same posting's Ashby application subpage and records it without the query", async () => {
    const worker = await background();
    const posting = "https://jobs.ashbyhq.com/Synthetic/00000000-0000-4000-8000-000000000009";
    const source = worker.fixture.job.sources[0];
    if (!source) throw new Error("Missing fixture source");
    source.canonicalUrl = posting;
    worker.browser.tabs.query.mockResolvedValue([
      { id: 7, url: `${posting}/application?jr_id=synthetic` },
    ]);
    worker.browser.tabs.get.mockResolvedValue({
      id: 7,
      url: `${posting}/application?jr_id=synthetic`,
    });
    const result = await worker.send({ action: "application_form_capture", reviewLink: LINK });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.observedForm ?? "{}").destination).toBe(`${posting}/application`);
  });
  it("captures questions on a challenge page and records the challenge for the candidate", async () => {
    const worker = await background();
    worker.browser.scripting.executeScript.mockResolvedValue([
      {
        result: {
          challengePresent: true,
          fields: [
            { ref: "f0", name: "email", label: "Email", type: "text", required: true, options: [] },
          ],
        },
      },
    ]);
    const result = await worker.send({ action: "application_form_capture", reviewLink: LINK });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.observedForm ?? "{}").form.challengePresent).toBe(true);
  });
  it.each(["disabled", "destination", "owner", "no_questions", "values", "active_attempt"])(
    "refuses %s form capture",
    async (kind) => {
      const worker = await background(kind !== "disabled");
      if (kind === "destination")
        worker.browser.tabs.query.mockResolvedValue([{ id: 7, url: "https://other.example/" }]);
      if (kind === "owner") worker.fixture.application.id = "00000000-0000-7000-8000-000000000099";
      if (kind === "no_questions")
        worker.browser.scripting.executeScript.mockResolvedValue([
          { result: { challengePresent: true, fields: [] } },
        ]);
      if (kind === "values")
        worker.browser.scripting.executeScript.mockResolvedValue([
          {
            result: {
              challengePresent: false,
              fields: [
                {
                  ref: "f0",
                  name: "auth",
                  label: "Work authorization",
                  type: "select",
                  required: true,
                  options: ["Yes", "No"],
                  value: "PRIVATE",
                } as never,
              ],
            },
          },
        ]);
      if (kind === "active_attempt")
        worker.fixture.application.attempts = [
          {
            id: "00000000-0000-7000-8000-000000000044",
            sequence: 1,
            status: "ambiguous",
            adapterId: "manual",
            adapterVersion: "none",
            startedAt: new Date().toISOString(),
          },
        ];
      expect((await worker.send({ action: "application_form_capture", reviewLink: LINK })).ok).toBe(
        false,
      );
    },
  );
  it("refuses a tab change during structure inspection", async () => {
    const worker = await background();
    worker.browser.scripting.executeScript.mockImplementation(async () => {
      worker.browser.tabs.query.mockResolvedValue([{ id: 8, url: EMPLOYER }]);
      return [{ result: { challengePresent: false, fields: [] } }];
    });
    expect((await worker.send({ action: "application_form_capture", reviewLink: LINK })).ok).toBe(
      false,
    );
  });
  it("bounds a stalled page inspection and ignores its late result", async () => {
    vi.useFakeTimers();
    const worker = await background();
    worker.browser.scripting.executeScript.mockImplementation(() => new Promise(() => undefined));
    const result = worker.send({ action: "application_form_capture", reviewLink: LINK });
    await vi.advanceTimersByTimeAsync(30_001);
    expect((await result).ok).toBe(false);
    expect((await worker.send({ action: "application_handoff_clear" })).ok).toBe(true);
    vi.useRealTimers();
  });
  it("rechecks each copy, preserves No, and writes no private answers to extension storage", async () => {
    const worker = await background();
    const preview = await worker.send({ action: "application_handoff_read", reviewLink: LINK });
    expect(preview.ok).toBe(true);
    const calls = worker.fetcher.mock.calls.length;
    const copied = await worker.send({
      action: "application_handoff_copy",
      snapshotId: preview.snapshotId,
      fieldKey: "authorization.us_authorized",
      confirmed: true,
    });
    expect(copied).toEqual({ ok: true, value: "No" });
    expect(worker.fetcher.mock.calls.length - calls).toBe(4);
    expect(JSON.stringify([...worker.local, ...worker.session])).not.toContain(
      "synthetic@example.test",
    );
    expect(worker.browser.storage.session.set).not.toHaveBeenCalled();
  });
  it("defaults dark and rejects content scripts and malformed requests without an API call", async () => {
    const worker = await background(false);
    expect((await worker.send({ action: "application_handoff_read", reviewLink: LINK })).ok).toBe(
      false,
    );
    expect(
      (
        await worker.send(
          { action: "application_handoff_read", reviewLink: LINK },
          { id: worker.browser.runtime.id, tab: { id: 7 } as chrome.tabs.Tab, url: EMPLOYER },
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await worker.send({
          action: "application_handoff_copy",
          snapshotId: "-".repeat(36),
          fieldKey: "contact.email",
          confirmed: true,
        })
      ).ok,
    ).toBe(false);
    expect(
      worker.fetcher.mock.calls.every(([url]) =>
        String(url).endsWith("/contribution-capability-policy"),
      ),
    ).toBe(true);
  });
  it.each(["tab", "packet", "identity", "clear", "expiry"])(
    "refuses copy after %s changed",
    async (kind) => {
      const worker = await background();
      const preview = await worker.send({ action: "application_handoff_read", reviewLink: LINK });
      expect(preview.ok).toBe(true);
      if (kind === "tab") worker.browser.tabs.query.mockResolvedValue([{ id: 8, url: EMPLOYER }]);
      if (kind === "packet") worker.fixture.application.revision++;
      if (kind === "identity") {
        const api = await import("../lib/protocol");
        vi.mocked(api.authenticatedApiSession).mockResolvedValue({
          accessToken: "synthetic-token",
          identityFence: "b".repeat(43),
        });
      }
      if (kind === "clear") await worker.send({ action: "application_handoff_clear" });
      if (kind === "expiry") await vi.advanceTimersByTimeAsync(60_001);
      expect(
        (
          await worker.send({
            action: "application_handoff_copy",
            snapshotId: preview.snapshotId,
            fieldKey: "authorization.us_authorized",
            confirmed: true,
          })
        ).ok,
      ).toBe(false);
    },
  );
  it("aborts a pending owner read on clear and never restores a late preview", async () => {
    const worker = await background();
    let finish: (response: Response) => void = () => {
      throw new Error("Not pending");
    };
    worker.fetcher.mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const preview = worker.send({ action: "application_handoff_read", reviewLink: LINK });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    await worker.send({ action: "application_handoff_clear" });
    finish(
      new Response(JSON.stringify(worker.fixture.application), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      }),
    );
    expect((await preview).ok).toBe(false);
  });
  it("refuses a preview when the active employer tab changes during owner reads", async () => {
    const worker = await background();
    worker.browser.tabs.query
      .mockResolvedValueOnce([{ id: 7, url: EMPLOYER }])
      .mockResolvedValue([{ id: 8, url: EMPLOYER }]);
    expect((await worker.send({ action: "application_handoff_read", reviewLink: LINK })).ok).toBe(
      false,
    );
  });
});
