import { createHash } from "node:crypto";
import type {
  ApplicationNativeTransferAdmission,
  ApplicationNativeTransferReceipt,
} from "@ai-job-apply/api-contracts";
import { activeJobRevisionDigestInput } from "@ai-job-apply/api-contracts/job-revision-canonical";
import { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { afterEach, expect, it, vi } from "vitest";
import { installNativeTransferBackground } from "../lib/native-transfer-background";
import { APP, handoffFixture, LINK, WEB } from "./application-handoff-fixture";

const EMPLOYER = "https://boards.greenhouse.io/synthetic/jobs/123";
const DOCUMENT = "00000000-0000-7000-8000-000000000007";
const SOURCE_DOCUMENT = "00000000-0000-7000-8000-000000000008";
const compositions: ReturnType<typeof installNativeTransferBackground>[] = [];

function setup(dark = false) {
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
      onMessageExternal: {
        addListener: vi.fn((callback: typeof listener) => {
          listener = callback;
        }),
      },
    },
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
  const send = vi.fn(async (url: URL | RequestInfo) =>
    Response.json(
      String(url).includes("/authorization?")
        ? fixture.proof
        : String(url).includes("/v1/jobs/")
          ? fixture.job
          : fixture.application,
      { headers: { "cache-control": "no-store" } },
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
    tab: { id: 9, incognito: false } as chrome.tabs.Tab,
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
    browser,
    send,
    identity,
    composition,
    message,
    begin,
    commit,
    navigate: (tabId: number) => navigation(tabId, { status: "loading" }, {} as chrome.tabs.Tab),
    remove: (tabId: number) => removed(tabId, { windowId: 1, isWindowClosing: false }),
    authChanged: () => storage({ auth0Session: { newValue: { changed: true } } }, "session"),
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
  expect(f.browser.scripting.executeScript).toHaveBeenCalledTimes(4);
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
