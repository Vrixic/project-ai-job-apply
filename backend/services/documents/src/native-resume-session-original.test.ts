import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createNativeResumeSession,
  type NativeResumeIdentity,
  nativeResumeJobHash,
} from "./native-resume-session.js";
import { linksOf, parse, resumePdf } from "./render/original/test-support.js";

// The real claim only exists on Linux, where the isolated process runs.
vi.mock("./native-material-process.js", () => ({ claimNativeMaterialProcess: () => undefined }));

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const job = { title: "Graphics Programmer", description: "Vulkan renderer shader work" };

async function generate(options: { withOriginal: boolean; swapOriginal?: Uint8Array }) {
  const original = await resumePdf();
  const sha256 = createHash("sha256").update(original).digest("hex");
  const document = await parse(original);
  const identity: NativeResumeIdentity = {
    generationId: id(1),
    ownerUserId: id(2),
    applicationId: id(3),
    version: 1,
    baseDocumentId: document.documentId,
    baseVersion: document.version,
    baseSha256: sha256,
    jobContextSha256: nativeResumeJobHash(job),
  };
  const sent = options.swapOriginal ?? original;
  const session = createNativeResumeSession({
    identity,
    source: {
      load: async () => ({
        document,
        job,
        ...(options.withOriginal
          ? { originalPdfBase64: Buffer.from(sent).toString("base64") }
          : {}),
      }),
    },
    checkAdmission: async () => undefined,
    completion: { claimOriginalCompletion: async () => "claimed" } as never,
    kernel: {
      shortenBoot: () => undefined,
      bindCompletion: () => undefined,
      terminate: () => {
        throw new Error("terminated");
      },
    },
    enabled: () => true,
  });
  const generated = await session.generate();
  const read = await session.read(generated.reference, "pdf");
  const value = read.value as { bytes: Uint8Array; mediaType: string; sha256: string };
  const bytes = Uint8Array.from(value.bytes);
  read.release();
  return { bytes, value };
}

describe("native resume generation with the candidate's own PDF", () => {
  it("returns the candidate's own design when the original is supplied", async () => {
    const { bytes, value } = await generate({ withOriginal: true });
    expect(value.mediaType).toBe("application/pdf");
    expect(bytes.byteLength).toBeLessThanOrEqual(300_000);
    // The link and its address exist only because the original page was edited, not redrawn.
    expect((await linksOf(bytes)).map((link) => link.uri)).toEqual([
      "https://example.com/renderer",
    ]);
  });

  it("falls back to the recorded layout without the original", async () => {
    const { bytes } = await generate({ withOriginal: false });
    expect(await linksOf(bytes)).toEqual([]);
    expect(Buffer.from(bytes).toString("latin1").startsWith("%PDF-")).toBe(true);
  });

  it("does not use a file that is not the one the document was parsed from", async () => {
    const other = await resumePdf({ compress: false });
    const { bytes } = await generate({ withOriginal: true, swapOriginal: other });
    expect(await linksOf(bytes)).toEqual([]);
  });
});
