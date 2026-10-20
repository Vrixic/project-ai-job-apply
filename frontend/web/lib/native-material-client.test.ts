import { describe, expect, it, vi } from "vitest";
import { nativeMaterialReadFailureCopy, readNativeMaterial } from "./native-material-client";

const APP = "00000000-0000-7000-8000-000000000001";
const PACKET = "00000000-0000-7000-8000-000000000003";
const GEN = "00000000-0000-7000-8000-000000000020";
const PACKET_HASH = "b".repeat(64);
const CONTENT_HASH = "a".repeat(64);

function material(overrides: Record<string, unknown> = {}) {
  const completedAtMs = Date.now() - 60_000;
  return {
    schemaVersion: 1 as const,
    kind: "tailored_resume" as const,
    generationId: GEN,
    version: 1,
    contentSha256: CONTENT_HASH,
    completedAtMs,
    expiresAtMs: completedAtMs + 1_800_000,
    ...overrides,
  };
}

const binding = () => ({
  applicationId: APP,
  packetId: PACKET,
  packetHash: PACKET_HASH,
  material: material(),
});

const body = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });

function preview(bound: ReturnType<typeof binding>, overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    matchesPacket: true,
    tailoringVersion: "1",
    contentSha256: CONTENT_HASH,
    temporaryMaterial: bound.material,
    sections: [],
    ...overrides,
  };
}

function pdf(bound: ReturnType<typeof binding>, overrides: Record<string, unknown> = {}) {
  return {
    format: "pdf",
    mediaType: "application/pdf",
    fileName: "tailored-resume.pdf",
    sha256: "c".repeat(64),
    sizeBytes: 4,
    contentSha256: CONTENT_HASH,
    contentBase64: "JVBERg==",
    temporaryMaterial: bound.material,
    ...overrides,
  };
}

describe("generated material client", () => {
  it("reads through the same-origin BFF with no credential of its own", async () => {
    const bound = binding();
    const send = vi.fn<typeof fetch>().mockResolvedValue(body(preview(bound)));
    const value = await readNativeMaterial(bound, "preview", { fetch: send });
    expect(value).toMatchObject({ status: "ready" });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe(
      `/api/platform/applications/${APP}/resume/content?generationId=${GEN}&packetHash=${PACKET_HASH}&format=preview`,
    );
    expect(init).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
    expect(JSON.stringify(init)).not.toMatch(/authorization|bearer/iu);
  });

  it("asks for the PDF only and refuses a Word file", async () => {
    const bound = binding();
    const send = vi.fn<typeof fetch>().mockResolvedValue(body(pdf(bound)));
    expect(await readNativeMaterial(bound, "pdf", { fetch: send })).toMatchObject({
      format: "pdf",
    });
    expect(String(send.mock.calls[0]?.[0])).toContain("format=pdf");
    const word = vi.fn<typeof fetch>().mockResolvedValue(
      body(
        pdf(bound, {
          format: "docx",
          mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ),
    );
    await expect(readNativeMaterial(bound, "pdf", { fetch: word })).rejects.toThrow(
      "MaterialReadUnavailable",
    );
    // @ts-expect-error DOCX is no longer a readable format.
    await expect(readNativeMaterial(bound, "docx", { fetch: send })).rejects.toThrow();
  });

  it("reads a cover letter from its own route", async () => {
    const letter = { ...binding(), material: material({ kind: "cover_letter" }) };
    const send = vi.fn<typeof fetch>().mockResolvedValue(
      body({
        status: "ready",
        documentId: APP,
        version: 1,
        contentSha256: CONTENT_HASH,
        matchesPacket: true,
        reviewRequired: true,
        paragraphs: [{ text: "Hello", factIds: [PACKET] }],
        model: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
        promptVersion: "1",
        temporaryMaterial: letter.material,
      }),
    );
    await readNativeMaterial(letter, "preview", { fetch: send });
    expect(String(send.mock.calls[0]?.[0])).toContain("/cover-letter/content?");
  });

  it.each([
    [
      "another generation",
      (b: ReturnType<typeof binding>) =>
        preview(b, { temporaryMaterial: { ...b.material, generationId: PACKET } }),
    ],
    [
      "another content hash",
      (b: ReturnType<typeof binding>) => preview(b, { contentSha256: "d".repeat(64) }),
    ],
    ["a packet mismatch", (b: ReturnType<typeof binding>) => preview(b, { matchesPacket: false })],
    [
      "another expiry",
      (b: ReturnType<typeof binding>) =>
        preview(b, {
          temporaryMaterial: {
            ...b.material,
            completedAtMs: b.material.completedAtMs + 1,
            expiresAtMs: b.material.expiresAtMs + 1,
          },
        }),
    ],
    ["an unknown field", (b: ReturnType<typeof binding>) => ({ ...preview(b), extra: true })],
  ])("refuses a response with %s", async (_name, make) => {
    const bound = binding();
    const send = vi.fn<typeof fetch>().mockResolvedValue(body(make(bound)));
    await expect(readNativeMaterial(bound, "preview", { fetch: send })).rejects.toThrow(
      "MaterialReadUnavailable",
    );
  });

  it("refuses an expired material without any request", async () => {
    const expired = {
      ...binding(),
      material: material({
        completedAtMs: Date.now() - 3_600_000,
        expiresAtMs: Date.now() - 1_800_000,
      }),
    };
    const send = vi.fn<typeof fetch>();
    await expect(readNativeMaterial(expired, "preview", { fetch: send })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses malformed identifiers without any request", async () => {
    const send = vi.fn<typeof fetch>();
    await expect(
      readNativeMaterial({ ...binding(), applicationId: "nope" }, "preview", { fetch: send }),
    ).rejects.toThrow();
    await expect(
      readNativeMaterial({ ...binding(), packetHash: "zz" }, "preview", { fetch: send }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses cacheable, wrongly typed and oversized responses", async () => {
    const bound = binding();
    for (const response of [
      body(preview(bound), 200, { "cache-control": "max-age=60" }),
      body(preview(bound), 200, { "content-type": "text/html" }),
      new Response(JSON.stringify({ padding: "x".repeat(600 * 1024) }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      }),
    ]) {
      const send = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(readNativeMaterial(bound, "preview", { fetch: send })).rejects.toThrow();
    }
  });

  it("classifies refusals into fixed copy without upstream text", async () => {
    const bound = binding();
    const failures: unknown[] = [];
    for (const status of [401, 403, 503]) {
      const send = vi.fn<typeof fetch>().mockResolvedValue(body({ code: "secret-detail" }, status));
      await readNativeMaterial(bound, "preview", { fetch: send }).catch((error: unknown) =>
        failures.push(error),
      );
    }
    const copies = failures.map(nativeMaterialReadFailureCopy);
    expect(copies[0]).toContain("Sign in again");
    expect(copies[1]).toContain("Sign in again");
    expect(copies[2]).toContain("could not be loaded right now");
    expect(copies.join(" ")).not.toContain("secret-detail");
    expect(nativeMaterialReadFailureCopy(new Error("x"))).toContain("Generate it again");
  });

  it("stops reading when the caller aborts", async () => {
    const bound = binding();
    const controller = new AbortController();
    const send = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const pending = readNativeMaterial(bound, "preview", {
      fetch: send,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow("MaterialReadUnavailable");
  });
});
