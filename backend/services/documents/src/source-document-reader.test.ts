import { createHash } from "node:crypto";
import { GetObjectCommand, GetObjectTaggingCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { MAXIMUM_ORIGINAL_PDF_BYTES } from "./original-pdf.js";
import { S3SourceDocumentReader, type SourceDocument } from "./source-document-reader.js";

const documentId = "019a4000-0000-7000-8000-000000000006";
const kms = "arn:aws:kms:us-east-2:123456789012:key/11111111-2222-3333-4444-555555555555";
const bytes = new TextEncoder().encode("%PDF-1.4 synthetic original");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const source: SourceDocument = {
  documentId,
  objectKey: `quarantine/${documentId}/source`,
  objectVersion: "version-1",
  sha256,
  sizeBytes: bytes.byteLength,
  mediaType: "application/pdf",
};

function client(
  overrides: { tags?: unknown[]; head?: Record<string, unknown>; body?: Uint8Array } = {},
) {
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof GetObjectTaggingCommand)
      return {
        TagSet: overrides.tags ?? [
          { Key: "GuardDutyMalwareScanStatus", Value: "NO_THREATS_FOUND" },
        ],
      };
    if (command instanceof HeadObjectCommand)
      return {
        VersionId: "version-1",
        ContentLength: bytes.byteLength,
        ContentType: "application/pdf",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: kms,
        Metadata: { "document-id": documentId, sha256 },
        ...overrides.head,
      };
    if (command instanceof GetObjectCommand)
      return { Body: { transformToByteArray: async () => overrides.body ?? bytes } };
    throw new Error("unexpected command");
  });
  return { send, reader: new S3SourceDocumentReader("documents-bucket", kms, { send }) };
}

describe("reading the candidate's own PDF", () => {
  it("returns exactly the scanned, recorded object", async () => {
    const { reader, send } = client();
    expect(await reader.read(source)).toEqual(bytes);
    expect(send).toHaveBeenCalledTimes(3);
    for (const [command] of send.mock.calls)
      expect((command as { input: { VersionId: string } }).input.VersionId).toBe("version-1");
  });

  it("reads nothing that is not a PDF or is too large to edit", async () => {
    const { reader, send } = client();
    expect(await reader.read({ ...source, mediaType: "application/vnd.docx" })).toBeUndefined();
    expect(
      await reader.read({ ...source, sizeBytes: MAXIMUM_ORIGINAL_PDF_BYTES + 1 }),
    ).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["an unscanned object", { tags: [] }],
    [
      "an object with threats found",
      { tags: [{ Key: "GuardDutyMalwareScanStatus", Value: "THREATS_FOUND" }] },
    ],
    ["another version", { head: { VersionId: "version-2" } }],
    ["another size", { head: { ContentLength: 5 } }],
    ["another media type", { head: { ContentType: "application/octet-stream" } }],
    ["another encryption key", { head: { SSEKMSKeyId: "arn:aws:kms:us-east-2:1:key/other" } }],
    ["another owner document", { head: { Metadata: { "document-id": "x", sha256 } } }],
    [
      "another recorded hash",
      { head: { Metadata: { "document-id": documentId, sha256: "0".repeat(64) } } },
    ],
    [
      "bytes that do not hash to the record",
      { body: new TextEncoder().encode("%PDF-1.4 different!!!!!!") },
    ],
  ])("refuses %s", async (_name, overrides) => {
    const { reader } = client(overrides);
    await expect(reader.read(source)).rejects.toThrow();
  });

  it("refuses a key that is not the document's own source object", async () => {
    const { reader, send } = client();
    await expect(
      reader.read({ ...source, objectKey: "quarantine/other-document/source" }),
    ).rejects.toThrow("SourceObjectKeyInvalid");
    expect(send).not.toHaveBeenCalled();
  });
});
