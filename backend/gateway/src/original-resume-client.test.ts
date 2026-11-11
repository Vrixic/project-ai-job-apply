import { createHash } from "node:crypto";
import {
  ORIGINAL_RESUME_RESULT_SCHEMA,
  parseOriginalResumeRequest,
} from "@ai-job-apply/documents-service";
import { describe, expect, it, vi } from "vitest";
import {
  LambdaOriginalResumeClient,
  OriginalResumeTransportError,
} from "./original-resume-client.js";

const OWNER = "0192f7c2-0000-7000-8000-000000000001";
const APPLICATION = "0192f7c2-0000-7000-8000-0000000000a1";
const GENERATION = "0192f7c2-0000-7000-8000-0000000000c1";
const DOCUMENT = "0192f7c2-0000-7000-8000-0000000000d1";
const OTHER_DOCUMENT = "0192f7c2-0000-7000-8000-0000000000d2";
const PDF = Buffer.from("%PDF-1.4 synthetic original resume bytes");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const ready = (overrides: Record<string, unknown> = {}, bytes: Uint8Array = PDF) => ({
  schema: ORIGINAL_RESUME_RESULT_SCHEMA,
  status: "ready",
  document: {
    id: DOCUMENT,
    fileName: "Candidate Resume.pdf",
    format: "pdf",
    mediaType: "application/pdf",
    sizeBytes: PDF.byteLength,
    sha256: sha(PDF),
  },
  contentBase64: Buffer.from(bytes).toString("base64"),
  ...overrides,
});

function client(respond: () => unknown | { FunctionError: string }) {
  const sent: unknown[] = [];
  const send = vi.fn(async (command: { input: { Payload: Uint8Array } }) => {
    sent.push(JSON.parse(new TextDecoder().decode(command.input.Payload)));
    const value = respond();
    if (value && typeof value === "object" && "FunctionError" in value)
      return value as { FunctionError: string };
    return { Payload: new TextEncoder().encode(JSON.stringify(value)) };
  });
  const subject = new LambdaOriginalResumeClient(
    "arn:aws:lambda:us-east-2:123456789012:function:document-processor:development",
    { send } as never,
  );
  return { subject, sent };
}

describe("the original resume client", () => {
  it("asks for one chosen document by id and checks it is that document", async () => {
    const { subject, sent } = client(() => ready());
    expect(await subject.file(OWNER, DOCUMENT)).toMatchObject({ documentId: DOCUMENT });
    expect(sent).toEqual([
      { kind: "original-resume-v1", mode: "file", ownerUserId: OWNER, documentId: DOCUMENT },
    ]);
    await expect(client(() => ready()).subject.file(OWNER, OTHER_DOCUMENT)).rejects.toBeInstanceOf(
      OriginalResumeTransportError,
    );
  });

  describe("the original a generated resume was made from", () => {
    it("names only the application and the generation, never a document", async () => {
      const { subject, sent } = client(() => ready());
      expect(await subject.generationFile(OWNER, APPLICATION, GENERATION)).toEqual({
        documentId: DOCUMENT,
        sha256: sha(PDF),
        sizeBytes: PDF.byteLength,
        fileName: "Candidate Resume.pdf",
        format: "pdf",
        mediaType: "application/pdf",
        contentBase64: PDF.toString("base64"),
      });
      expect(sent).toEqual([
        {
          kind: "original-resume-v1",
          mode: "generation_file",
          ownerUserId: OWNER,
          applicationId: APPLICATION,
          generationId: GENERATION,
        },
      ]);
    });

    it("sends a request the Documents processor accepts as exactly what it is", async () => {
      // The two sides release separately: what the client sends must parse with the processor's own
      // contract, or the comparison would fail only after both are live.
      const { subject, sent } = client(() => ready());
      await subject.generationFile(OWNER, APPLICATION, GENERATION);
      await subject.file(OWNER, DOCUMENT);
      expect(sent).toHaveLength(2);
      for (const request of sent) expect(parseOriginalResumeRequest(request)).toEqual(request);
    });

    it("returns nothing when Documents finds no such original", async () => {
      const { subject } = client(() => ({
        schema: ORIGINAL_RESUME_RESULT_SCHEMA,
        status: "no_resume",
      }));
      expect(await subject.generationFile(OWNER, APPLICATION, GENERATION)).toBeUndefined();
    });

    it.each([
      ["a runtime error", () => ({ FunctionError: "Unhandled" })],
      [
        "an unavailable original",
        () => ({
          schema: ORIGINAL_RESUME_RESULT_SCHEMA,
          status: "unavailable",
          reason: "document_unreadable",
        }),
      ],
      [
        "bytes that are not the file described",
        () => ready({}, Buffer.from("%PDF-1.4 other bytes of equal length!!")),
      ],
      ["a result with no bytes", () => ready({ contentBase64: undefined })],
      ["a malformed result", () => ({ status: "ready" })],
    ])("is an outage, not an absent original, for %s", async (_name, respond) => {
      await expect(
        client(respond).subject.generationFile(OWNER, APPLICATION, GENERATION),
      ).rejects.toBeInstanceOf(OriginalResumeTransportError);
    });
  });
});
