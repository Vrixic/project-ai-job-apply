import { createHash } from "node:crypto";
import type { ApplicationNativeTransferAdmission } from "@ai-job-apply/api-contracts";
import { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type NativeExtensionMessenger,
  transferApprovedNativeMaterials,
} from "../../web/lib/native-extension-transfer";
import { readNativeMaterial } from "../../web/lib/native-material-client";
import {
  createNativeMaterialTransfer,
  type NativeTransferSelection,
} from "../lib/native-material-transfer";
import { sameNativeTransferBinding } from "../lib/native-transfer-binding";

const id = (value: number) => `00000000-0000-7000-8000-${String(value).padStart(12, "0")}`;
const ORIGIN = "https://workspace.example.invalid";
const controllers: ReturnType<typeof createNativeMaterialTransfer>[] = [];
vi.mock("../../web/lib/native-material-client", () => ({ readNativeMaterial: vi.fn() }));

function setup() {
  const now = Date.now();
  const selection: NativeTransferSelection = {
    applicationId: id(1),
    packetId: id(2),
    packetHash: "b".repeat(64),
    approvalId: id(3),
    revision: 4,
    approvalExpiresAtMs: now + 120_000,
    materials: [
      {
        schemaVersion: 1,
        kind: "tailored_resume",
        generationId: id(4),
        version: 1,
        contentSha256: "c".repeat(64),
        completedAtMs: now - 1_000,
        expiresAtMs: now - 1_000 + 1_800_000,
      },
    ],
    reviewLink: `${ORIGIN}/jobs?application=${id(1)}&job=${id(5)}`,
    jobId: id(5),
    ownerFence: "SIMULATED-OWNER",
    tabId: 7,
    documentId: id(6),
    employerUrl: "https://boards.greenhouse.io/synthetic/jobs/123",
    variantId: "synthetic-unit-only",
  };
  // All gate/evidence claims in this fixture are simulated, never provider acceptance.
  const registry = new AdapterRegistry(
    [
      {
        id: "greenhouse-application-v1",
        provider: "greenhouse",
        version: "0.1.0",
        variants: [selection.variantId],
        capabilities: { autofill: true, fileAttach: true, confirmationDetection: true },
      },
    ],
    {
      enabled: { "greenhouse-application-v1": true },
      liveEffectsApproved: true,
      fixtureEvidence: {
        "greenhouse-application-v1": {
          kind: "provider_derived",
          authorizationRecordId: "SIMULATED-NOT-PROVIDER-EVIDENCE",
          sanitizationScanPassedAt: new Date(now).toISOString(),
          qaRepresentativenessAcceptedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 1_800_000).toISOString(),
          variantIds: [selection.variantId],
        },
      },
    },
  );
  const revalidate = vi.fn(async (): Promise<void> => undefined);
  const transfer = createNativeMaterialTransfer({ webOrigin: ORIGIN, registry, revalidate });
  controllers.push(transfer);
  transfer.select(selection);
  const sender: chrome.runtime.MessageSender = {
    origin: ORIGIN,
    url: selection.reviewLink,
    frameId: 0,
    documentLifecycle: "active",
    documentId: id(8),
    tab: { id: 9, incognito: false } as chrome.tabs.Tab,
  };
  const begin = {
    schema: "application-native-transfer-begin.v1",
    applicationId: selection.applicationId,
    packetId: selection.packetId,
    packetHash: selection.packetHash,
    format: "pdf",
  };
  const bytes = new TextEncoder().encode("%PDF-synthetic-only");
  const file = {
    format: "pdf",
    mediaType: "application/pdf",
    fileName: "resume.pdf",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
    contentSha256: selection.materials[0]?.contentSha256,
    contentBase64: Buffer.from(bytes).toString("base64"),
    temporaryMaterial: selection.materials[0],
  };
  const commit = (admission: ApplicationNativeTransferAdmission) => ({
    schema: "application-native-transfer-commit.v1",
    admission,
    files: [structuredClone(file)],
  });
  return { transfer, selection, sender, begin, file, bytes, commit, revalidate, registry };
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.clear();
  vi.restoreAllMocks();
  vi.mocked(readNativeMaterial).mockReset();
  vi.useRealTimers();
});

function connected() {
  const f = setup();
  const controller = new AbortController();
  const messages: unknown[] = [];
  const nativeFile = structuredClone(f.file);
  vi.mocked(readNativeMaterial).mockResolvedValue(
    nativeFile as Awaited<ReturnType<typeof readNativeMaterial>>,
  );
  const messenger: NativeExtensionMessenger = {
    sendMessage: vi.fn((_extensionId, raw, callback) => {
      // Chrome's JSON transport copies messages. No actual installed extension or provider call.
      const message = JSON.parse(JSON.stringify(raw));
      messages.push(message);
      let response: Promise<unknown>;
      if (message.schema === "application-native-transfer-begin.v1")
        response = f.transfer.begin(message, f.sender);
      else if (message.schema === "application-native-transfer-commit.v1")
        response = f.transfer.commit(message, f.sender);
      else {
        try {
          if (message.schema === "application-native-transfer-cancel.v1")
            f.transfer.cancel(message, f.sender);
          else f.transfer.discard(message, f.sender);
          response = Promise.resolve({ ok: true });
        } catch {
          response = Promise.reject(Error("unavailable"));
        }
      }
      void response.then(callback, () => callback({ error: "unavailable" }));
    }),
  };
  const isCurrent = vi.fn(() => true);
  const run = () =>
    transferApprovedNativeMaterials({
      extensionId: "a".repeat(32),
      messenger,
      binding: f.selection,
      isCurrent,
      signal: controller.signal,
    });
  return { ...f, controller, messages, nativeFile, messenger, isCurrent, run };
}

describe("website-to-extension transport with simulated native and Chrome boundaries", () => {
  it("transfers approved bytes without credentials, wipes producer copies, and retains the receiving inventory", async () => {
    const f = connected();
    const receipt = await f.run();
    expect(f.nativeFile.contentBase64).toBe("");
    expect(f.messages).toHaveLength(2);
    expect(JSON.stringify(f.messages)).not.toMatch(
      /accessToken|refreshToken|authorization|Bearer/u,
    );
    expect(
      vi.mocked(f.messenger.sendMessage).mock.calls.every(([target]) => target === "a".repeat(32)),
    ).toBe(true);
    const owned = f.transfer.consume(receipt);
    expect(owned.files[0]?.bytes).toEqual(f.bytes);
    owned.dispose();
  });

  it.each(["approval", "hash", "size", "magic"])(
    "refuses changed web %s before commit",
    async (mode) => {
      const f = connected();
      vi.mocked(readNativeMaterial).mockImplementation(async () => {
        if (mode === "approval") f.isCurrent.mockReturnValue(false);
        if (mode === "hash") f.nativeFile.sha256 = "d".repeat(64);
        if (mode === "size") f.nativeFile.sizeBytes++;
        if (mode === "magic") f.nativeFile.contentBase64 = btoa("not-pdf");
        return f.nativeFile as Awaited<ReturnType<typeof readNativeMaterial>>;
      });
      await expect(f.run()).rejects.toThrow("NativeExtensionTransferUnavailable");
      expect(f.nativeFile.contentBase64).toBe("");
      expect(
        f.messages.some(
          (value) =>
            (value as { schema: string }).schema === "application-native-transfer-commit.v1",
        ),
      ).toBe(false);
      expect(f.messages.at(-1)).toMatchObject({ schema: "application-native-transfer-cancel.v1" });
      await expect(f.transfer.begin(f.begin, f.sender)).rejects.toThrow();
    },
  );

  it("cancels an unresolved receiving commit after cancellation even when the acknowledgement is lost", async () => {
    const f = connected();
    let started = () => {};
    const reached = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.revalidate.mockResolvedValueOnce(undefined).mockImplementationOnce(() => {
      started();
      return new Promise<void>(() => {});
    });
    const pending = f.run();
    const refused = expect(pending).rejects.toThrow("NativeExtensionTransferUnavailable");
    await reached;
    f.controller.abort();
    await refused;
    expect(f.messages.at(-1)).toMatchObject({ schema: "application-native-transfer-cancel.v1" });
    expect(f.nativeFile.contentBase64).toBe("");
    await expect(f.transfer.begin(f.begin, f.sender)).rejects.toThrow();
  });

  it("cancels a ready receiver after a lost success acknowledgement", async () => {
    const f = connected();
    let ready = () => {};
    const reached = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const send = f.messenger.sendMessage.bind(f.messenger);
    f.messenger.sendMessage = (target, value, callback) => {
      send(target, value, (reply) => {
        if ((value as { schema: string }).schema === "application-native-transfer-commit.v1")
          ready();
        else callback(reply);
      });
    };
    const pending = f.run();
    const refused = expect(pending).rejects.toThrow();
    await reached;
    f.controller.abort();
    await refused;
    expect(f.messages.at(-1)).toMatchObject({ schema: "application-native-transfer-cancel.v1" });
    await expect(f.transfer.begin(f.begin, f.sender)).rejects.toThrow();
  });

  it("refuses native reads when the admission has a changed packet binding", async () => {
    const f = connected();
    f.messenger.sendMessage = (_target, _value, callback) =>
      callback({
        schema: "application-native-transfer-admission.v1",
        nonce: "a".repeat(64),
        expiresAtMs: Date.now() + 30_000,
        applicationId: f.selection.applicationId,
        packetId: id(15),
        packetHash: f.selection.packetHash,
        approvalId: f.selection.approvalId,
        revision: f.selection.revision,
        format: "pdf",
        materials: f.selection.materials,
      });
    await expect(f.run()).rejects.toThrow();
    expect(readNativeMaterial).not.toHaveBeenCalled();
  });
});

describe("bounded memory-only native file transfer", () => {
  it("accepts reordered JSONB material, admission and receipt keys without changing values", async () => {
    const f = setup();
    const admission = await f.transfer.begin(f.begin, f.sender);
    const input = f.commit(admission);
    input.admission = Object.fromEntries(Object.entries(admission).reverse()) as typeof admission;
    const file = input.files[0];
    if (!file?.temporaryMaterial) throw Error("fixture");
    file.temporaryMaterial = Object.fromEntries(
      Object.entries(file.temporaryMaterial).reverse(),
    ) as typeof file.temporaryMaterial;
    const receipt = await f.transfer.commit(input, f.sender);
    expect(
      f.transfer.consume(Object.fromEntries(Object.entries(receipt).reverse()) as typeof receipt)
        .files,
    ).toHaveLength(1);
  });

  it.each([
    [{ value: 1 }, { value: "1" }],
    [{ value: 1 }, {}],
    [{ value: 1 }, { value: 1, extra: true }],
    [{ values: [1, 2] }, { values: [2, 1] }],
    [{ value: undefined }, { value: undefined }],
    [{ value: Number.NaN }, { value: Number.NaN }],
    [{ value: new Date(0) }, { value: new Date(0) }],
    [{ values: [1, 2, 3] }, { values: [1, 2, 3] }],
  ])("keeps metadata type, exact key set and array order strict (%j)", (left, right) => {
    expect(sameNativeTransferBinding(left, right)).toBe(false);
  });

  it("refuses cyclic/deep or excessive-key metadata without unbounded recursion", () => {
    const cycle: { next?: unknown } = {};
    cycle.next = cycle;
    expect(sameNativeTransferBinding(cycle, cycle)).toBe(false);
    const large = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [String(index), index]),
    );
    expect(sameNativeTransferBinding(large, large)).toBe(false);
  });
  it("binds original expiry, admits once, consumes once, and zeroes the executor's exact bytes", async () => {
    const f = setup();
    const admission = await f.transfer.begin(f.begin, f.sender);
    expect(admission.expiresAtMs).toBeLessThanOrEqual(Date.now() + 60_000);
    const receipt = await f.transfer.commit(f.commit(admission), f.sender);
    expect(receipt.expiresAtMs).toBe(f.selection.approvalExpiresAtMs);
    const inventory = f.transfer.consume(receipt);
    const bytes = inventory.files[0]?.bytes;
    expect(bytes).toEqual(f.bytes);
    expect(() => f.transfer.consume(receipt)).toThrow();
    inventory.dispose();
    expect(bytes?.every((byte) => byte === 0)).toBe(true);
    expect(inventory.signal.aborted).toBe(true);
    expect(inventory.files).toHaveLength(0);
    expect(f.revalidate).toHaveBeenCalledTimes(3);
  });

  it.each([
    "origin",
    "url",
    "frame",
    "lifecycle",
    "document",
    "tab",
    "incognito",
    "extension",
    "native",
  ])("refuses a mismatched or missing Chrome sender %s", async (mode) => {
    const f = setup();
    const sender = structuredClone(f.sender);
    if (mode === "origin") sender.origin = "https://other.example.invalid";
    if (mode === "url") sender.url = `${ORIGIN}/jobs?application=${id(10)}&job=${id(5)}`;
    if (mode === "frame") sender.frameId = 1;
    if (mode === "lifecycle") sender.documentLifecycle = "prerender";
    if (mode === "document") delete sender.documentId;
    if (mode === "tab") delete sender.tab;
    if (mode === "incognito" && sender.tab) sender.tab.incognito = true;
    if (mode === "extension") sender.id = "a".repeat(32);
    if (mode === "native") sender.nativeApplication = "other";
    await expect(f.transfer.begin(f.begin, sender)).rejects.toThrow();
    expect(f.revalidate).not.toHaveBeenCalled();
  });

  it("atomically refuses concurrent begin while the first owner check is unresolved", async () => {
    const f = setup();
    let release = () => {};
    f.revalidate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = f.transfer.begin(f.begin, f.sender);
    await expect(f.transfer.begin(f.begin, f.sender)).rejects.toThrow();
    release();
    await expect(first).resolves.toMatchObject({ applicationId: f.selection.applicationId });
  });

  it("atomically spends the nonce before an unresolved commit owner check", async () => {
    const f = setup();
    const admission = await f.transfer.begin(f.begin, f.sender);
    let release = () => {};
    f.revalidate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = f.transfer.commit(f.commit(admission), f.sender);
    await expect(f.transfer.commit(f.commit(admission), f.sender)).rejects.toThrow();
    release();
    await expect(first).resolves.toMatchObject({ nonce: admission.nonce });
    await expect(f.transfer.commit(f.commit(admission), f.sender)).rejects.toThrow();
  });

  it.each([
    "hash",
    "size",
    "magic",
    "type",
    "material",
    "duplicate",
    "missing",
    "nonce",
    "extra",
    "cap",
  ])("refuses invalid committed %s with no retained inventory", async (mode) => {
    const f = setup();
    const admission = await f.transfer.begin(f.begin, f.sender);
    const input = f.commit(admission);
    const file = input.files[0];
    if (!file) throw Error("fixture");
    if (mode === "hash") file.sha256 = "d".repeat(64);
    if (mode === "size") file.sizeBytes++;
    if (mode === "magic") {
      const bytes = new TextEncoder().encode("not-pdf");
      file.contentBase64 = Buffer.from(bytes).toString("base64");
      file.sizeBytes = bytes.length;
      file.sha256 = createHash("sha256").update(bytes).digest("hex");
    }
    if (mode === "type")
      file.mediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (mode === "material" && file.temporaryMaterial) file.temporaryMaterial.version++;
    if (mode === "duplicate") input.files.push(structuredClone(file));
    if (mode === "missing") input.files = [];
    if (mode === "nonce") input.admission = { ...admission, nonce: "e".repeat(64) };
    if (mode === "extra") Object.assign(input, { accessToken: "NEVER-A-TOKEN" });
    if (mode === "cap") file.contentBase64 = "A".repeat(850_000);
    await expect(f.transfer.commit(input, f.sender)).rejects.toThrow();
    expect(() =>
      f.transfer.consume({
        schema: "application-native-transfer-receipt.v1",
        nonce: admission.nonce,
        expiresAtMs: f.selection.approvalExpiresAtMs,
        applicationId: f.selection.applicationId,
        packetId: f.selection.packetId,
        packetHash: f.selection.packetHash,
      }),
    ).toThrow();
  });

  it.each(["source", "destination", "cancel", "clear", "expiry"])(
    "immediately wipes decoded bytes during unresolved hashing on %s",
    async (mode) => {
      vi.useFakeTimers();
      const f = setup();
      const admission = await f.transfer.begin(f.begin, f.sender);
      let bytes: Uint8Array | undefined;
      let release: (value: ArrayBuffer) => void = () => {};
      vi.spyOn(crypto.subtle, "digest").mockImplementationOnce((_algorithm, value) => {
        bytes = value as Uint8Array;
        return new Promise<ArrayBuffer>((resolve) => {
          release = resolve;
        });
      });
      const pending = f.transfer.commit(f.commit(admission), f.sender);
      const refused = expect(pending).rejects.toThrow();
      for (let i = 0; i < 10 && !bytes; i++) await Promise.resolve();
      expect(bytes).toEqual(f.bytes);
      if (mode === "source") f.transfer.documentChanged(f.sender.tab?.id ?? -1);
      if (mode === "destination") f.transfer.documentChanged(f.selection.tabId);
      if (mode === "cancel")
        f.transfer.cancel({ schema: "application-native-transfer-cancel.v1", admission }, f.sender);
      if (mode === "clear") f.transfer.clear();
      if (mode === "expiry") await vi.advanceTimersByTimeAsync(60_001);
      expect(bytes?.every((byte) => byte === 0)).toBe(true);
      release(new Uint8Array(32).buffer);
      await refused;
    },
  );

  it("aborts a hanging final owning proof and wipes its decoded bytes before it settles", async () => {
    const f = setup();
    const admission = await f.transfer.begin(f.begin, f.sender);
    let bytes: Uint8Array | undefined;
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, value) => {
      bytes = value as Uint8Array;
      return digest(algorithm, value);
    });
    let finalStarted = () => {};
    const reached = new Promise<void>((resolve) => {
      finalStarted = resolve;
    });
    f.revalidate.mockResolvedValueOnce(undefined).mockImplementationOnce(() => {
      finalStarted();
      return new Promise<void>(() => {});
    });
    const pending = f.transfer.commit(f.commit(admission), f.sender);
    const refused = expect(pending).rejects.toThrow();
    await reached;
    f.transfer.clear();
    expect(bytes?.every((byte) => byte === 0)).toBe(true);
    await refused;
  });

  it("keeps replacement selection independent of late completion of the old begin", async () => {
    const f = setup();
    let release = () => {};
    f.revalidate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const old = f.transfer.begin(f.begin, f.sender);
    const refused = expect(old).rejects.toThrow();
    f.transfer.select(f.selection);
    release();
    await refused;
    await expect(f.transfer.begin(f.begin, f.sender)).resolves.toBeDefined();
  });

  it("requires the same sender document for commit and exact nonce for cancellation", async () => {
    const f = setup();
    const admission = await f.transfer.begin(f.begin, f.sender);
    await expect(
      f.transfer.commit(f.commit(admission), { ...f.sender, documentId: id(12) }),
    ).rejects.toThrow();
    expect(() =>
      f.transfer.cancel(
        {
          schema: "application-native-transfer-cancel.v1",
          admission: { ...admission, nonce: "f".repeat(64) },
        },
        f.sender,
      ),
    ).toThrow();
    const receipt = await f.transfer.commit(f.commit(admission), f.sender);
    f.transfer.discard({ schema: "application-native-transfer-discard.v1", receipt }, f.sender);
    expect(() => f.transfer.consume(receipt)).toThrow();
  });

  it("refuses default-dark policy without owner reads", async () => {
    const f = setup();
    vi.spyOn(f.registry, "status").mockReturnValue({ mode: "off", reasons: ["kill_switch_off"] });
    await expect(f.transfer.begin(f.begin, f.sender)).rejects.toThrow();
    expect(f.revalidate).not.toHaveBeenCalled();
  });
});

describe("the candidate's own uploaded resume selection", () => {
  const document = { documentId: id(30), sha256: "e".repeat(64) };
  const original = new TextEncoder().encode("%PDF-1.4 the candidate's own original");

  function uploadedSetup() {
    const f = setup();
    f.transfer.clear();
    const selection: NativeTransferSelection = {
      ...f.selection,
      materials: [],
      uploadedResume: document,
    };
    f.transfer.select(selection);
    const file = (overrides: Record<string, unknown> = {}) => ({
      kind: "uploaded_resume" as const,
      format: "pdf" as const,
      mediaType: "application/pdf",
      sha256: document.sha256,
      bytes: new Uint8Array(original),
      ...overrides,
    });
    return { ...f, selection, file };
  }

  it("is ready for the executor with the original bytes, only for a short lease inside the approval", () => {
    const f = uploadedSetup();
    const bytes = new Uint8Array(original);
    f.transfer.attachUploaded(f.selection, f.file({ bytes }));
    const owned = f.transfer.consumeSelected(f.selection.reviewLink);
    expect(owned.files).toHaveLength(1);
    expect(owned.files[0]).toMatchObject({ kind: "uploaded_resume", format: "pdf" });
    expect(owned.files[0]?.generationId).toBeUndefined();
    expect(owned.selection.uploadedResume).toEqual(document);
    // Held until the earlier of ten minutes and the approval deadline.
    expect(owned.deadline).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
    expect(owned.deadline).toBeLessThanOrEqual(f.selection.approvalExpiresAtMs);
    owned.dispose();
    expect(owned.files.length).toBe(0);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
    expect(() => f.transfer.consumeSelected(f.selection.reviewLink)).toThrow();
  });

  it("is never offered a generated-file transfer", async () => {
    const f = uploadedSetup();
    await expect(f.transfer.begin(f.begin, f.sender)).rejects.toThrow();
  });

  it.each([
    ["another digest", { sha256: "f".repeat(64) }],
    ["a generated kind", { kind: "tailored_resume" as const }],
    ["a generation id", { generationId: id(31) }],
    ["no bytes", { bytes: new Uint8Array(0) }],
    ["an oversized file", { bytes: new Uint8Array(2 * 1024 * 1024 + 1) }],
  ])("refuses %s", (_name, change) => {
    const f = uploadedSetup();
    expect(() => f.transfer.attachUploaded(f.selection, f.file(change))).toThrow();
    expect(() => f.transfer.consumeSelected(f.selection.reviewLink)).toThrow();
  });

  it("refuses a file for another selection, a second file, and a missing selection", () => {
    const f = uploadedSetup();
    expect(() =>
      f.transfer.attachUploaded({ ...f.selection, packetHash: "d".repeat(64) }, f.file()),
    ).toThrow();
    f.transfer.attachUploaded(f.selection, f.file());
    expect(() => f.transfer.attachUploaded(f.selection, f.file())).toThrow();
    f.transfer.clear();
    expect(() => f.transfer.attachUploaded(f.selection, f.file())).toThrow();
  });

  it.each([
    [
      "neither a generated file nor an uploaded one",
      (s: NativeTransferSelection) => {
        const { uploadedResume: _removed, ...without } = s;
        return without;
      },
    ],
    [
      "both a generated file and an uploaded one",
      (s: NativeTransferSelection) => ({ ...s, materials: setup().selection.materials }),
    ],
    [
      "a malformed document id",
      (s: NativeTransferSelection) => ({
        ...s,
        uploadedResume: { ...document, documentId: "nope" },
      }),
    ],
    [
      "a malformed digest",
      (s: NativeTransferSelection) => ({ ...s, uploadedResume: { ...document, sha256: "short" } }),
    ],
  ])("refuses to select with %s", (_name, change) => {
    const f = setup();
    const base: NativeTransferSelection = {
      ...f.selection,
      materials: [],
      uploadedResume: document,
    };
    const next = change(base);
    f.transfer.clear();
    expect(() => f.transfer.select(next)).toThrow();
  });

  it("clears the held original with the employer tab", () => {
    const f = uploadedSetup();
    const bytes = new Uint8Array(original);
    f.transfer.attachUploaded(f.selection, f.file({ bytes }));
    f.transfer.documentChanged(f.selection.tabId);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
    expect(() => f.transfer.consumeSelected(f.selection.reviewLink)).toThrow();
  });
});
