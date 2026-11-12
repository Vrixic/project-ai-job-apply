import { createHash } from "node:crypto";
import type {
  ApplicationNativeTransferAdmission,
  ApplicationNativeTransferReceipt,
} from "@ai-job-apply/api-contracts";
import { activeJobRevisionDigestInput } from "@ai-job-apply/api-contracts/job-revision-canonical";
import { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installNativeTransferBackground } from "../lib/native-transfer-background";
import { APP, handoffFixture, LINK, WEB } from "./application-handoff-fixture";

const EMPLOYER = "https://boards.greenhouse.io/synthetic/jobs/123";
const DOCUMENT = "00000000-0000-7000-8000-000000000007";
const SOURCE_DOCUMENT = "00000000-0000-7000-8000-000000000008";
const compositions: ReturnType<typeof installNativeTransferBackground>[] = [];

function setup(dark = false, session = new Map<string, unknown>()) {
  const fixture = handoffFixture();
  const source = fixture.job.sources[0];
  const packet = fixture.application.currentPacket;
  if (!source || !packet) throw Error("fixture");
  source.canonicalUrl = EMPLOYER;
  packet.jobRevision = createHash("sha256")
    .update(activeJobRevisionDigestInput(fixture.job))
    .digest("hex");
  let listener: Parameters<typeof chrome.runtime.onMessageExternal.addListener>[0];
  let navigation: Parameters<typeof chrome.tabs.onUpdated.addListener>[0];
  let removed: Parameters<typeof chrome.tabs.onRemoved.addListener>[0];
  let storage: Parameters<typeof chrome.storage.onChanged.addListener>[0];
  const browser = {
    runtime: {
      id: "extension-id",
      sendMessage: vi.fn(async (_message: unknown) => undefined),
      // The answer icon's own message listener (ADR-057).
      onMessage: { addListener: vi.fn() },
      onMessageExternal: {
        addListener: vi.fn((callback: typeof listener) => {
          listener = callback;
        }),
      },
    },
    sidePanel: { open: vi.fn(async (_options: { windowId: number }) => undefined) },
    tabs: {
      get: vi.fn(async () => ({ id: 7, url: EMPLOYER, incognito: false })),
      query: vi.fn(async () => [{ id: 7, url: EMPLOYER, incognito: false }]),
      onUpdated: {
        addListener: vi.fn((callback: typeof navigation) => {
          navigation = callback;
        }),
      },
      onRemoved: {
        addListener: vi.fn((callback: typeof removed) => {
          removed = callback;
        }),
      },
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => (session.has(key) ? { [key]: session.get(key) } : {})),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) session.set(key, value);
        }),
        remove: vi.fn(async (key: string) => {
          session.delete(key);
        }),
      },
      onChanged: {
        addListener: vi.fn((callback: typeof storage) => {
          storage = callback;
        }),
      },
    },
    scripting: {
      executeScript: vi.fn(async () => [
        { frameId: 0, documentId: DOCUMENT, result: { url: EMPLOYER, topFrame: true } },
      ]),
    },
  };
  vi.stubGlobal("chrome", browser);
  const uploaded: { body: unknown } = { body: undefined };
  const send = vi.fn(async (url: URL | RequestInfo, _init?: RequestInit) =>
    Response.json(
      String(url).includes("/authorization?")
        ? fixture.proof
        : String(url).includes("/resume/uploaded")
          ? (uploaded.body ?? { code: "application_packet_stale" })
          : String(url).includes("/v1/jobs/")
            ? fixture.job
            : fixture.application,
      {
        status: String(url).includes("/resume/uploaded") && !uploaded.body ? 409 : 200,
        headers: { "cache-control": "no-store" },
      },
    ),
  );
  vi.stubGlobal("fetch", send);
  const registry = new AdapterRegistry();
  // Composition-test gate only; production installation uses the unchanged default-dark registry.
  if (!dark) vi.spyOn(registry, "status").mockReturnValue({ mode: "autofill", reasons: [] });
  const identity = vi.fn(
    async (): Promise<{ accessToken: string; identityFence: string }> => ({
      accessToken: "synthetic-not-a-credential",
      identityFence: "SIMULATED-OWNER",
    }),
  );
  const composition = installNativeTransferBackground({
    webOrigin: WEB,
    apiOrigin: "https://api.example.invalid",
    registry,
    identity,
  });
  compositions.push(composition);
  const sender: chrome.runtime.MessageSender = {
    origin: WEB,
    url: LINK,
    frameId: 0,
    documentId: SOURCE_DOCUMENT,
    documentLifecycle: "active",
    tab: { id: 9, windowId: 3, incognito: false } as chrome.tabs.Tab,
  };
  const begin = {
    schema: "application-native-transfer-begin.v1",
    applicationId: APP,
    packetId: packet.id,
    packetHash: packet.packetHash,
    format: "pdf",
  };
  const message = <T>(value: unknown) =>
    new Promise<T>((resolve) => {
      expect(listener(value, sender, resolve)).toBe(true);
    });
  const commit = async () => {
    await composition.select(LINK);
    const admission = await message<ApplicationNativeTransferAdmission>(begin);
    const bytes = new TextEncoder().encode("%PDF-Synthetic only");
    const receipt = await message<ApplicationNativeTransferReceipt>({
      schema: "application-native-transfer-commit.v1",
      admission,
      files: [
        {
          format: "pdf",
          mediaType: "application/pdf",
          fileName: "resume.pdf",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          sizeBytes: bytes.length,
          contentSha256: packet.artifactHashes.resume,
          temporaryMaterial: packet.temporaryMaterials?.[0],
          contentBase64: Buffer.from(bytes).toString("base64"),
        },
      ],
    });
    return { receipt, inventory: composition.consume(receipt) };
  };
  return {
    fixture,
    uploaded,
    sender,
    browser,
    send,
    identity,
    composition,
    message,
    begin,
    commit,
    navigate: (tabId: number) => navigation(tabId, { status: "loading" }, {} as chrome.tabs.Tab),
    /** The tab moves to another address without loading a new document, as a page does by itself. */
    navigateTo: (tabId: number, url: string) =>
      navigation(tabId, { url }, { id: tabId, url } as chrome.tabs.Tab),
    remove: (tabId: number) => removed(tabId, { windowId: 1, isWindowClosing: false }),
    authChanged: () => storage({ auth0Session: { newValue: { changed: true } } }, "session"),
    authChange: (change: { oldValue?: unknown; newValue?: unknown }) =>
      storage({ auth0Session: change as chrome.storage.StorageChange }, "session"),
    /** What a token refresh writes: new tokens for the same account. */
    authRefreshed: (before = "OWNER-FENCE", after = before) =>
      storage(
        {
          auth0Session: {
            oldValue: { accessToken: "old", identityFence: before },
            newValue: { accessToken: "new", identityFence: after },
          },
        },
        "session",
      ),
  };
}

afterEach(() => {
  for (const composition of compositions.splice(0)) composition.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses protected owner/job/material reads and binds the exact current top-frame destination", async () => {
  const f = setup();
  const { inventory } = await f.commit();
  expect(inventory.files).toHaveLength(1);
  expect(f.send.mock.calls.some(([url]) => String(url).includes("/authorization?"))).toBe(true);
  // Four reads and checks, plus the answer icon (ADR-057) put into exactly the selected document.
  expect(f.browser.scripting.executeScript).toHaveBeenCalledTimes(5);
  expect(f.browser.scripting.executeScript).toHaveBeenCalledWith({
    target: { tabId: 7, documentIds: [DOCUMENT] },
    files: ["narrative-answer.js"],
    world: "ISOLATED",
  });
  expect(inventory.selection.documentId).toBe(DOCUMENT);
  inventory.dispose();
});

it("keeps production registry dark even when the separate transport is installed", async () => {
  const f = setup(true);
  await f.composition.select(LINK);
  await expect(f.message(f.begin)).resolves.toEqual({ error: "NativeMaterialTransferUnavailable" });
});

it("accepts matching owner metadata returned in PostgreSQL JSONB key order", async () => {
  const f = setup();
  await f.composition.select(LINK);
  const materials = f.fixture.application.currentPacket?.temporaryMaterials;
  const material = materials?.[0];
  if (!materials || !material) throw Error("fixture");
  materials[0] = Object.fromEntries(Object.entries(material).reverse()) as typeof material;
  await expect(f.message(f.begin)).resolves.toMatchObject({
    schema: "application-native-transfer-admission.v1",
  });
});

it.each([
  "destination-navigation",
  "source-navigation",
  "destination-close",
  "source-close",
  "identity",
  "cancel",
])("immediately wipes an owned receiving inventory on %s", async (mode) => {
  const f = setup();
  const { inventory } = await f.commit();
  const bytes = inventory.files[0]?.bytes;
  expect(bytes?.some((byte) => byte !== 0)).toBe(true);
  if (mode === "destination-navigation") f.navigate(7);
  if (mode === "source-navigation") f.navigate(9);
  if (mode === "destination-close") f.remove(7);
  if (mode === "source-close") f.remove(9);
  if (mode === "identity") f.authChanged();
  if (mode === "cancel") f.composition.clear();
  expect(bytes?.every((byte) => byte === 0)).toBe(true);
  expect(inventory.signal.aborted).toBe(true);
});

it("cannot resurrect a selection cleared during an unresolved protected identity read", async () => {
  const f = setup();
  let release = (_value: { accessToken: string; identityFence: string }) => {};
  let started = () => {};
  const reached = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.identity.mockImplementationOnce(() => {
    started();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const pending = f.composition.select(LINK);
  const refused = expect(pending).rejects.toThrow();
  await reached;
  f.composition.clear();
  await refused;
  release({ accessToken: "synthetic", identityFence: "SIMULATED-OWNER" });
  await Promise.resolve();
  await expect(f.message(f.begin)).resolves.toEqual({ error: "NativeMaterialTransferUnavailable" });
});

it.each(["document", "owner", "approval", "job"])(
  "refuses a changed %s proof between selection and admission",
  async (mode) => {
    const f = setup();
    await f.composition.select(LINK);
    if (mode === "document")
      f.browser.scripting.executeScript.mockResolvedValue([
        { frameId: 0, documentId: SOURCE_DOCUMENT, result: { url: EMPLOYER, topFrame: true } },
      ]);
    if (mode === "owner")
      f.identity.mockResolvedValue({ accessToken: "synthetic", identityFence: "DIFFERENT-OWNER" });
    if (mode === "approval") f.fixture.application.revision++;
    if (mode === "job") f.fixture.job.title = "Changed synthetic title";
    await expect(f.message(f.begin)).resolves.toEqual({
      error: "NativeMaterialTransferUnavailable",
    });
  },
);

const ORIGINAL = new TextEncoder().encode("%PDF-1.4 the candidate's own original resume");
const ORIGINAL_SHA = createHash("sha256").update(ORIGINAL).digest("hex");
const UPLOADED_DOCUMENT = "00000000-0000-7000-8000-000000000030";

/** A packet bound to the candidate's own uploaded resume instead of a generated one. */
function uploadedSetup(change: Record<string, unknown> = {}) {
  const f = setup();
  const packet = f.fixture.application.currentPacket;
  const approval = f.fixture.application.approval;
  if (!packet || !approval) throw Error("fixture");
  delete packet.temporaryMaterials;
  packet.artifactHashes = { resume: ORIGINAL_SHA };
  packet.fields.push({
    fieldKey: "documents.resume",
    value: ORIGINAL_SHA,
    origin: "confirmed_fact",
    sourceFactIds: [UPLOADED_DOCUMENT],
    confidence: 1,
    disposition: "review",
    reasons: ["explicit_each_time"],
    requiresReview: true,
  });
  approval.acknowledgedFieldKeys.push("documents.resume");
  f.uploaded.body = {
    documentId: UPLOADED_DOCUMENT,
    fileName: "Candidate Resume.pdf",
    format: "pdf",
    mediaType: "application/pdf",
    sha256: ORIGINAL_SHA,
    sizeBytes: ORIGINAL.byteLength,
    contentBase64: Buffer.from(ORIGINAL).toString("base64"),
    ...change,
  };
  return f;
}

it("pulls the candidate's own uploaded resume with the extension's own session and holds only the original bytes", async () => {
  const f = uploadedSetup();
  await expect(f.composition.select(LINK)).resolves.toEqual({ ok: true, resume: "uploaded" });
  const request = f.send.mock.calls.find(([url]) => String(url).includes("/resume/uploaded"));
  expect(String(request?.[0])).toBe(
    `https://api.example.invalid/v1/applications/${APP}/resume/uploaded`,
  );
  expect(request?.[1]).toMatchObject({
    method: "GET",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  expect(JSON.stringify(request?.[1])).toContain("synthetic-not-a-credential");
  const owned = f.composition.consumeSelected(LINK);
  expect(owned.files).toHaveLength(1);
  expect(owned.files[0]).toMatchObject({ kind: "uploaded_resume", format: "pdf" });
  expect(owned.files[0]?.bytes).toEqual(ORIGINAL);
  expect(owned.selection.materials).toEqual([]);
  expect(owned.selection.uploadedResume).toEqual({
    documentId: UPLOADED_DOCUMENT,
    sha256: ORIGINAL_SHA,
  });
  const bytes = owned.files[0]?.bytes;
  owned.dispose();
  expect(bytes?.every((byte) => byte === 0)).toBe(true);
});

it.each([
  ["a changed file", { sha256: "d".repeat(64) }],
  ["another document", { documentId: "00000000-0000-7000-8000-000000000031" }],
  [
    "bytes that are not the bound digest",
    { contentBase64: Buffer.from("%PDF-1.4 other bytes").toString("base64"), sizeBytes: 20 },
  ],
  ["a mismatched size", { sizeBytes: 5 }],
  ["a mismatched media type", { mediaType: "application/octet-stream" }],
  [
    "a PDF that is not a PDF",
    { contentBase64: Buffer.from("not a pdf at all, sorry!!").toString("base64"), sizeBytes: 25 },
  ],
  ["an oversized file", { sizeBytes: 2 * 1024 * 1024 + 1 }],
])("refuses an uploaded resume with %s and keeps nothing", async (_name, change) => {
  const f = uploadedSetup(change);
  await expect(f.composition.select(LINK)).rejects.toThrow("NativeMaterialTransferUnavailable");
  expect(() => f.composition.consumeSelected(LINK)).toThrow();
});

it("keeps the selection and its file when the same page is selected again", async () => {
  const f = uploadedSetup();
  await f.composition.select(LINK);
  await expect(f.composition.select(LINK)).resolves.toEqual({ ok: true, resume: "uploaded" });
  const pulls = f.send.mock.calls.filter(([url]) => String(url).includes("/resume/uploaded"));
  expect(pulls).toHaveLength(1);
  expect(f.composition.consumeSelected(LINK).files).toHaveLength(1);
});

it("refuses when the packet carries no resume at all", async () => {
  const f = uploadedSetup();
  const packet = f.fixture.application.currentPacket;
  if (packet) {
    packet.artifactHashes = {};
    packet.fields = packet.fields.filter((field) => field.fieldKey !== "documents.resume");
  }
  await expect(f.composition.select(LINK)).rejects.toThrow("NativeMaterialTransferUnavailable");
});

it("refuses when the owner identity changed before the pull", async () => {
  const f = uploadedSetup();
  f.identity
    .mockResolvedValueOnce({ accessToken: "synthetic", identityFence: "SIMULATED-OWNER" })
    .mockResolvedValueOnce({ accessToken: "synthetic", identityFence: "SIMULATED-OWNER" })
    .mockResolvedValue({ accessToken: "synthetic", identityFence: "DIFFERENT-OWNER" });
  await expect(f.composition.select(LINK)).rejects.toThrow();
  expect(() => f.composition.consumeSelected(LINK)).toThrow();
});

it("wipes a pulled original when the employer tab or the extension identity changes", async () => {
  for (const change of ["navigate", "identity"] as const) {
    const f = uploadedSetup();
    await f.composition.select(LINK);
    const owned = f.composition.consumeSelected(LINK);
    const bytes = owned.files[0]?.bytes;
    expect(bytes?.some((byte) => byte !== 0)).toBe(true);
    if (change === "navigate") f.navigate(7);
    else f.authChanged();
    expect(bytes?.every((byte) => byte === 0)).toBe(true);
  }
});

it("keeps the selection, the resume and the pending Apply through a token refresh of the same account", async () => {
  const f = uploadedSetup();
  await f.message(INTENT);
  await f.composition.select(LINK);
  f.authRefreshed();
  expect(await f.composition.pendingIntent()).toMatchObject({ reviewLink: LINK });
  const owned = f.composition.consumeSelected(LINK);
  expect(owned.files[0]?.bytes.some((byte) => byte !== 0)).toBe(true);
  expect(owned.signal.aborted).toBe(false);
});

it.each([
  ["another account", { oldValue: { identityFence: "A" }, newValue: { identityFence: "B" } }],
  ["a sign-out", { oldValue: { identityFence: "A" } }],
  ["a first sign-in", { newValue: { identityFence: "A" } }],
  ["an unreadable session", { oldValue: { identityFence: "A" }, newValue: { accessToken: "x" } }],
])("still ends the selection on %s", async (_name, change) => {
  const f = uploadedSetup();
  await f.message(INTENT);
  await f.composition.select(LINK);
  const owned = f.composition.consumeSelected(LINK);
  const bytes = owned.files[0]?.bytes;
  f.authChange(change);
  expect(bytes?.every((byte) => byte === 0)).toBe(true);
  expect(await f.composition.pendingIntent()).toEqual({ ok: true });
});

describe("the employer page moving to its confirmation page", () => {
  const CONFIRMATION = `${EMPLOYER}/confirmation`;

  it("does not end a run that is underway: that move is the run's own outcome", async () => {
    const f = uploadedSetup();
    await f.composition.select(LINK);
    const owned = f.composition.consumeSelected(LINK);
    const bytes = owned.files[0]?.bytes;
    f.navigateTo(7, CONFIRMATION);
    expect(owned.signal.aborted).toBe(false);
    expect(bytes?.some((byte) => byte !== 0)).toBe(true);
  });

  it.each([
    ["another page of the board", `${EMPLOYER}/elsewhere`],
    [
      "the confirmation page of another job",
      "https://boards.greenhouse.io/synthetic/jobs/999/confirmation",
    ],
    ["another origin", "https://evil.example/synthetic/jobs/123/confirmation"],
  ])("still ends a run underway when the page moves to %s", async (_name, url) => {
    const f = uploadedSetup();
    await f.composition.select(LINK);
    const owned = f.composition.consumeSelected(LINK);
    const bytes = owned.files[0]?.bytes;
    f.navigateTo(7, url);
    expect(owned.signal.aborted).toBe(true);
    expect(bytes?.every((byte) => byte === 0)).toBe(true);
  });

  it("still ends a selection that no run has started when the page moves there", async () => {
    const f = uploadedSetup();
    await f.composition.select(LINK);
    f.navigateTo(7, CONFIRMATION);
    expect(() => f.composition.consumeSelected(LINK)).toThrow();
  });
});

it("never offers a generated-file transfer for an uploaded selection", async () => {
  const f = uploadedSetup();
  await f.composition.select(LINK);
  await expect(f.message(f.begin)).resolves.toEqual({ error: "NativeMaterialTransferUnavailable" });
});

const INTENT = {
  schema: "application-apply-intent.v1",
  applicationId: APP,
  jobId: "00000000-0000-7000-8000-000000000002",
  packetId: "00000000-0000-7000-8000-000000000003",
  packetHash: "a".repeat(64),
};

describe("the apply intent from the website", () => {
  it("acknowledges identifiers only and offers the review link to the popup, with no content", async () => {
    const f = setup();
    expect(await f.composition.pendingIntent()).toEqual({ ok: true });
    const receipt = await f.message<{ schema: string; expiresAtMs: number }>(INTENT);
    expect(receipt.schema).toBe("application-apply-intent-receipt.v1");
    expect(receipt.expiresAtMs).toBeGreaterThan(Date.now());
    expect(receipt.expiresAtMs).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
    const pending = await f.composition.pendingIntent();
    expect(pending).toMatchObject({ ok: true, reviewLink: LINK });
    // Only the link and its deadline are exposed; no packet, answer, file or token.
    expect(Object.keys(pending).sort()).toEqual(["expiresAtMs", "ok", "reviewLink"]);
    expect(f.send).not.toHaveBeenCalled();
  });

  it("accepts the intent while the browser still reports the load address of the page", async () => {
    const f = setup();
    const sender = { ...f.sender, url: `${WEB}/jobs` };
    await expect(
      new Promise((resolve) => {
        const listener = (chrome.runtime.onMessageExternal.addListener as ReturnType<typeof vi.fn>)
          .mock.calls[0]?.[0] as (m: unknown, s: unknown, r: (v: unknown) => void) => boolean;
        expect(listener(INTENT, sender, resolve)).toBe(true);
      }),
    ).resolves.toMatchObject({ schema: "application-apply-intent-receipt.v1" });
    expect(await f.composition.pendingIntent()).toMatchObject({ ok: true, reviewLink: LINK });
  });

  it.each([
    ["another website origin", { origin: "https://evil.example" }],
    ["an extension sender", { id: "other-extension-id" }],
    ["a subframe", { frameId: 3 }],
    ["an inactive document", { documentLifecycle: "prerender" as const }],
    ["a private window", { tab: { id: 9, incognito: true } as chrome.tabs.Tab }],
  ])("refuses an intent from %s", async (_name, change) => {
    const f = setup();
    const sender = { ...f.sender, ...change };
    await expect(
      new Promise((resolve) => {
        const listener = (chrome.runtime.onMessageExternal.addListener as ReturnType<typeof vi.fn>)
          .mock.calls[0]?.[0] as (m: unknown, s: unknown, r: (v: unknown) => void) => boolean;
        expect(listener(INTENT, sender, resolve)).toBe(true);
      }),
    ).resolves.toEqual({ error: "ApplicationApplyIntentUnavailable" });
    expect(await f.composition.pendingIntent()).toEqual({ ok: true });
  });

  it.each([
    ["an unknown field", { ...INTENT, token: "x" }],
    ["a malformed id", { ...INTENT, applicationId: "nope" }],
    ["a malformed hash", { ...INTENT, packetHash: "short" }],
    ["an oversized body", { ...INTENT, padding: "x".repeat(5000) }],
  ])("refuses an intent with %s", async (_name, value) => {
    const f = setup();
    await expect(f.message(value)).resolves.toEqual({ error: "ApplicationApplyIntentUnavailable" });
    expect(await f.composition.pendingIntent()).toEqual({ ok: true });
  });

  it("tells an open side panel when an application is armed", async () => {
    const f = setup();
    await f.message(INTENT);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ panel: "panel_notice" });
  });

  describe("the Apply click asks for the side panel", () => {
    const OPEN = { schema: "application-open-panel.v1" };
    const ask = (value: unknown, sender: chrome.runtime.MessageSender) =>
      new Promise((resolve) => {
        const listener = (chrome.runtime.onMessageExternal.addListener as ReturnType<typeof vi.fn>)
          .mock.calls[0]?.[0] as (m: unknown, s: unknown, r: (v: unknown) => void) => boolean;
        listener(value, sender, resolve);
      });

    it("opens the panel for the window the website is in", async () => {
      const f = setup();
      await expect(ask(OPEN, f.sender)).resolves.toEqual({
        schema: "application-open-panel-receipt.v1",
        opened: true,
      });
      expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 3 });
    });

    it("says so when the browser refuses to open it", async () => {
      const f = setup();
      vi.mocked(chrome.sidePanel.open).mockRejectedValueOnce(new Error("user gesture"));
      await expect(ask(OPEN, f.sender)).resolves.toEqual({
        schema: "application-open-panel-receipt.v1",
        opened: false,
      });
    });

    it.each([
      ["another website origin", { origin: "https://evil.example" }],
      ["an extension sender", { id: "other-extension-id" }],
      ["a subframe", { frameId: 3 }],
      ["an inactive document", { documentLifecycle: "prerender" as const }],
      ["a private window", { tab: { id: 9, windowId: 3, incognito: true } as chrome.tabs.Tab }],
      ["a sender with no window", { tab: { id: 9, incognito: false } as chrome.tabs.Tab }],
    ])("refuses a request from %s", async (_name, change) => {
      const f = setup();
      await expect(ask(OPEN, { ...f.sender, ...change })).resolves.toEqual({
        error: "ApplicationOpenPanelUnavailable",
      });
      expect(chrome.sidePanel.open).not.toHaveBeenCalled();
    });

    it("says the application is being prepared until the website arms the extension", async () => {
      const f = setup();
      expect(await f.composition.pendingIntent()).toEqual({ ok: true });
      await ask(OPEN, f.sender);
      expect(await f.composition.pendingIntent()).toEqual({
        ok: true,
        preparingUntilMs: expect.any(Number),
      });
      // An open panel is told; a panel that is still opening asks when it loads.
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ panel: "panel_notice" });
      await f.message(INTENT);
      const armed = await f.composition.pendingIntent();
      expect(armed).toMatchObject({ ok: true, reviewLink: LINK });
      expect(armed).not.toHaveProperty("preparingUntilMs");
    });

    it("stops saying it is preparing when the website never arms the extension", async () => {
      vi.useFakeTimers();
      try {
        const f = setup();
        await ask(OPEN, f.sender);
        expect(await f.composition.pendingIntent()).toHaveProperty("preparingUntilMs");
        vi.advanceTimersByTime(91_000);
        expect(await f.composition.pendingIntent()).toEqual({ ok: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not say it is preparing for a refused request", async () => {
      const f = setup();
      await ask(OPEN, { ...f.sender, origin: "https://evil.example" });
      expect(await f.composition.pendingIntent()).toEqual({ ok: true });
    });

    it("refuses a request that carries anything besides its schema", async () => {
      const f = setup();
      await expect(ask({ ...OPEN, applicationId: APP }, f.sender)).resolves.toEqual({
        error: "ApplicationOpenPanelUnavailable",
      });
      expect(chrome.sidePanel.open).not.toHaveBeenCalled();
    });
  });

  it("does not handle another schema version at all", () => {
    setup();
    const listener = (chrome.runtime.onMessageExternal.addListener as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as (m: unknown, s: unknown, r: (v: unknown) => void) => boolean;
    expect(
      listener({ ...INTENT, schema: "application-apply-intent.v2" }, {}, () => undefined),
    ).toBe(false);
  });

  it("forgets the intent when it expires, on clear, and on an identity change", async () => {
    vi.useFakeTimers();
    try {
      const f = setup();
      await f.message(INTENT);
      expect(await f.composition.pendingIntent()).toMatchObject({ reviewLink: LINK });
      vi.advanceTimersByTime(10 * 60_000 + 1);
      expect(await f.composition.pendingIntent()).toEqual({ ok: true });
      await f.message(INTENT);
      f.composition.clear();
      expect(await f.composition.pendingIntent()).toEqual({ ok: true });
      await f.message(INTENT);
      f.authChanged();
      expect(await f.composition.pendingIntent()).toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a pending intent across a service worker restart, and forgets it once expired or cleared", async () => {
    const session = new Map<string, unknown>();
    const first = setup(false, session);
    await first.message(INTENT);
    // A restarted worker has no memory but the same session storage.
    const restarted = setup(false, session);
    expect(await restarted.composition.pendingIntent()).toMatchObject({
      ok: true,
      reviewLink: LINK,
    });
    restarted.composition.clear();
    expect(await restarted.composition.pendingIntent()).toEqual({ ok: true });
    session.set("applicationApplyIntent", { reviewLink: LINK, deadline: Date.now() - 1 });
    expect(await setup(false, session).composition.pendingIntent()).toEqual({ ok: true });
    session.set("applicationApplyIntent", { reviewLink: 5, deadline: Date.now() + 1000 });
    expect(await setup(false, session).composition.pendingIntent()).toEqual({ ok: true });
  });

  it("lets a newer intent replace the older one and grants no transfer authority", async () => {
    const f = setup();
    await f.message(INTENT);
    await f.message({ ...INTENT, packetHash: "c".repeat(64) });
    expect(await f.composition.pendingIntent()).toMatchObject({ reviewLink: LINK });
    // An intent alone never admits a transfer: the candidate must still select the employer tab.
    await expect(f.message(f.begin)).resolves.toEqual({
      error: "NativeMaterialTransferUnavailable",
    });
  });
});

it("waits for a resume that is still arriving instead of refusing, and gives up when none comes", async () => {
  const f = setup();
  const packet = f.fixture.application.currentPacket;
  await f.composition.select(LINK);
  const admission = await f.message<ApplicationNativeTransferAdmission>(f.begin);
  const waiting = f.composition.waitForResume();
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(() => f.composition.consumeSelected(LINK)).toThrow();
  const bytes = new TextEncoder().encode("%PDF-Synthetic only");
  await f.message<ApplicationNativeTransferReceipt>({
    schema: "application-native-transfer-commit.v1",
    admission,
    files: [
      {
        format: "pdf",
        mediaType: "application/pdf",
        fileName: "resume.pdf",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.length,
        contentSha256: packet?.artifactHashes.resume,
        temporaryMaterial: packet?.temporaryMaterials?.[0],
        contentBase64: Buffer.from(bytes).toString("base64"),
      },
    ],
  });
  await waiting;
  expect(f.composition.consumeSelected(LINK).files).toHaveLength(1);
  const idle = setup();
  await idle.composition.select(LINK);
  const started = Date.now();
  await idle.composition.waitForResume(300);
  expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  expect(() => idle.composition.consumeSelected(LINK)).toThrow();
});
