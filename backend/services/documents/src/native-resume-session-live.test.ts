import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createNativeResumeSession,
  type NativeResumeIdentity,
  nativeResumeJobHash,
} from "./native-resume-session.js";
import { linksOf, parse, resumePdf } from "./render/original/test-support.js";
import { buildResumeAst } from "./resume-ast/build.js";
import type { ResumeAst } from "./resume-ast/types.js";
import {
  buildTailored,
  LIVE_TAILORING_VERSION,
  TAILORING_VERSION,
  type TailoredResume,
} from "./tailoring/tailor.js";

// The real claim only exists on Linux, where the isolated process runs.
vi.mock("./native-material-process.js", () => ({ claimNativeMaterialProcess: () => undefined }));

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const job = { title: "Graphics Programmer", description: "Vulkan renderer shader work" };

/** What a model would choose: every entry's own bullets, in the opposite order. Still only the candidate's own nodes. */
const reversed = (ast: ResumeAst): TailoredResume =>
  buildTailored(ast, job, LIVE_TAILORING_VERSION, (entry) => ({
    kept: [...entry.bullets].reverse(),
    omitted: [],
  }));

type LiveTailor = (
  ast: ResumeAst,
  job: { title: string; description: string },
) => Promise<TailoredResume | undefined>;

async function run(liveTailor?: LiveTailor) {
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
  const tailor = liveTailor ? vi.fn(liveTailor) : undefined;
  const session = createNativeResumeSession({
    identity,
    source: {
      load: async () => ({
        document,
        job,
        originalPdfBase64: Buffer.from(original).toString("base64"),
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
    ...(tailor ? { liveTailor: (ast, loadedJob) => tailor(ast, loadedJob) } : {}),
  } as Parameters<typeof createNativeResumeSession>[0]);
  const generated = await session.generate();
  const preview = await session.read(generated.reference, "preview");
  const sections = JSON.stringify(preview.value);
  preview.release();
  const pdf = await session.read(generated.reference, "pdf");
  const bytes = Uint8Array.from((pdf.value as { bytes: Uint8Array }).bytes);
  pdf.release();
  return { generated, sections, bytes, tailor, ast: buildResumeAst(document) };
}

describe("native resume generation with live tailoring", () => {
  it("is the deterministic tailor when no live tailor is composed", async () => {
    const { generated, tailor } = await run();
    expect(tailor).toBeUndefined();
    expect(generated.tailoringVersion).toBe(TAILORING_VERSION);
  });

  it("uses a valid live choice, records its version and binds a different content hash", async () => {
    const base = await run();
    const live = await run(async (ast) => reversed(ast));
    expect(live.generated.tailoringVersion).toBe(LIVE_TAILORING_VERSION);
    expect(live.tailor).toHaveBeenCalledTimes(1);
    expect(live.generated.reference.contentSha256).not.toBe(base.generated.reference.contentSha256);
    expect(live.sections).not.toBe(base.sections);
    // Still the candidate's own PDF, edited in place, with its link intact.
    expect((await linksOf(live.bytes)).map((link) => link.uri)).toEqual([
      "https://example.com/renderer",
    ]);
  });

  it("falls back to the deterministic tailor for every kind of failure, with the same result", async () => {
    const base = await run();
    const failures: [string, LiveTailor][] = [
      ["no answer", async () => undefined],
      ["throws", async () => Promise.reject(new Error("provider text and the resume"))],
      [
        "a node outside its entry",
        async (ast) => {
          const live = reversed(ast);
          const entry = live.sections.find((section) => section.kind === "experience")?.entries[0];
          if (!entry) throw new Error("fixture");
          entry.bulletNodeIds.push("not-a-node");
          return live;
        },
      ],
      [
        "a node used twice",
        async (ast) => {
          const live = reversed(ast);
          const entry = live.sections.find((section) => section.kind === "experience")?.entries[0];
          const first = entry?.bulletNodeIds[0];
          if (!entry || !first) throw new Error("fixture");
          entry.bulletNodeIds.push(first);
          return live;
        },
      ],
      [
        "another document",
        async (ast) => ({
          ...reversed(ast),
          base: { ...reversed(ast).base, sourceSha256: "b".repeat(64) },
        }),
      ],
    ];
    for (const [label, failing] of failures) {
      const result = await run(failing);
      expect(result.generated.tailoringVersion, label).toBe(TAILORING_VERSION);
      expect(result.generated.reference.contentSha256, label).toBe(
        base.generated.reference.contentSha256,
      );
      expect(result.sections, label).toBe(base.sections);
    }
  });

  it("passes the document's own tree and the job to the live tailor, nothing else", async () => {
    const seen: unknown[][] = [];
    const result = await run(async (ast, ...rest) => {
      seen.push([ast, ...rest]);
      return undefined;
    });
    expect(seen).toHaveLength(1);
    expect((seen[0]?.[0] as ResumeAst | undefined)?.documentId).toBe(result.ast.documentId);
    expect(seen[0]?.[1]).toEqual(job);
    expect(seen[0]).toHaveLength(2);
  });
});
