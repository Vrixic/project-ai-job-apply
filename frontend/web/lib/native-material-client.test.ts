import type { ApplicationTemporaryMaterial } from "@ai-job-apply/api-contracts";
import { afterEach, expect, it, vi } from "vitest";
import { readNativeMaterial } from "./native-material-client";
import type { NativeMaterialSession } from "./native-material-session";

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
function setup() {
  const material: ApplicationTemporaryMaterial = {
    schemaVersion: 1,
    kind: "tailored_resume",
    generationId: id(3),
    version: 1,
    contentSha256: "a".repeat(64),
    completedAtMs: Date.now(),
    expiresAtMs: Date.now() + 1_800_000,
  };
  const binding = { applicationId: id(1), packetId: id(2), packetHash: "b".repeat(64), material };
  // Routing allocation and original generation IDs are intentionally distinct.
  const origin = `https://${id(5)}.materials.example.test:8443`;
  const location = {
    schemaVersion: 1,
    packetId: binding.packetId,
    packetHash: binding.packetHash,
    temporaryMaterial: material,
    origin,
  };
  const preview = {
    status: "ready",
    matchesPacket: true,
    contentSha256: material.contentSha256,
    temporaryMaterial: material,
    sections: [],
  };
  const response = (value: unknown) =>
    Response.json(value, { headers: { "cache-control": "no-store" } });
  const send = vi.fn<typeof fetch>().mockImplementation(async () => response(location));
  const read = vi.fn().mockImplementation(async () => response(preview));
  const session = {
    ready: true,
    revision: 1,
    configuration: { baseHost: "materials.example.test" },
    read,
  } as unknown as NativeMaterialSession;
  const run = () => readNativeMaterial(session, binding, "preview", { fetch: send });
  return { binding, location, preview, response, send, read, session, run };
}
afterEach(() => vi.useRealTimers());
it("binds native content between two scalar proofs without forwarding a BFF bearer token", async () => {
  const f = setup();
  expect(await f.run()).toEqual(f.preview);
  expect(f.send).toHaveBeenCalledTimes(2);
  expect(f.send.mock.calls[0]?.[1]).toMatchObject({
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
  });
  expect(f.send.mock.calls[0]?.[1]?.headers).toBeUndefined();
  expect(f.read.mock.calls[0]?.[0].origin).toBe(f.location.origin);
});
it.each(["packet", "version", "expiry", "content", "unknown"])(
  "refuses changed %s bindings",
  async (mode) => {
    const f = setup();
    const changed = structuredClone(f.preview) as typeof f.preview & { unexpected?: string };
    if (mode === "packet")
      f.send.mockResolvedValueOnce(f.response({ ...f.location, packetHash: "c".repeat(64) }));
    if (mode === "version") changed.temporaryMaterial.version++;
    if (mode === "expiry") changed.temporaryMaterial.expiresAtMs++;
    if (mode === "content") changed.contentSha256 = "c".repeat(64);
    if (mode === "unknown") changed.unexpected = "unexpected";
    f.read.mockResolvedValueOnce(f.response(changed));
    await expect(f.run()).rejects.toThrow("MaterialReadUnavailable");
  },
);
it("refuses a packet changed after reading content", async () => {
  const f = setup();
  f.send
    .mockResolvedValueOnce(f.response(f.location))
    .mockResolvedValueOnce(f.response({ ...f.location, packetId: id(9) }));
  await expect(f.run()).rejects.toThrow("MaterialReadUnavailable");
});
it("refuses disconnect and renewed credentials during a held read", async () => {
  const f = setup();
  f.read.mockImplementation(async () => {
    Object.assign(f.session, { revision: 2 });
    return f.response(f.preview);
  });
  await expect(f.run()).rejects.toThrow("MaterialReadUnavailable");
});
it("bounds a fetch that ignores cancellation to fifteen seconds", async () => {
  vi.useFakeTimers();
  const f = setup();
  f.send.mockImplementation(() => new Promise(() => undefined));
  const result = expect(f.run()).rejects.toThrow("MaterialReadUnavailable");
  await vi.advanceTimersByTimeAsync(15_000);
  await result;
});
it.each(["cache", "oversized", "utf8"])("refuses %s response bodies", async (mode) => {
  const f = setup();
  const bytes = mode === "oversized" ? new Uint8Array(512 * 1024 + 1) : new Uint8Array([0xff]);
  f.read.mockResolvedValueOnce(
    mode === "cache"
      ? Response.json(f.preview)
      : new Response(bytes, {
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        }),
  );
  await expect(f.run()).rejects.toThrow("MaterialReadUnavailable");
});

it("never renews material expiry while a read is held", async () => {
  vi.useFakeTimers();
  const f = setup();
  const expiresAtMs = Date.now() + 1000;
  f.binding.material.completedAtMs = expiresAtMs - 1_800_000;
  f.binding.material.expiresAtMs = expiresAtMs;
  let cancelled = false;
  f.read.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "application/json", "cache-control": "no-store" } },
    ),
  );
  const result = expect(f.run()).rejects.toThrow("MaterialReadUnavailable");
  await vi.advanceTimersByTimeAsync(1000);
  await result;
  expect(cancelled).toBe(true);
  expect(f.send).toHaveBeenCalledTimes(1);
});

it("refuses malformed application paths before any network read", async () => {
  const f = setup();
  f.binding.applicationId = "../../other";
  await expect(f.run()).rejects.toThrow("MaterialReadUnavailable");
  expect(f.send).not.toHaveBeenCalled();
});

it("enforces the read deadline when the clock jumps before its timer executes", async () => {
  vi.useFakeTimers();
  const f = setup();
  f.read.mockImplementation(async () => {
    vi.setSystemTime(Date.now() + 15_001);
    return f.response(f.preview);
  });
  await expect(f.run()).rejects.toThrow("MaterialReadUnavailable");
});

it("rejects a PDF-labelled response carrying DOCX media metadata", async () => {
  const f = setup();
  f.read.mockResolvedValueOnce(
    f.response({
      format: "pdf",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "synthetic.pdf",
      sha256: "c".repeat(64),
      sizeBytes: 4,
      contentSha256: f.binding.material.contentSha256,
      contentBase64: btoa("test"),
      temporaryMaterial: f.binding.material,
    }),
  );
  await expect(readNativeMaterial(f.session, f.binding, "pdf", { fetch: f.send })).rejects.toThrow(
    "MaterialReadUnavailable",
  );
});
