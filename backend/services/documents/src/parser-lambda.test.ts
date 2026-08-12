import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createDocumentParserHandler, type DocumentParserInput } from "./parser-lambda.js";

function minimalPdf(): Uint8Array {
  const text = "Skills: TypeScript";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${text.length + 29} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(source));
    source += object;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}

function input(bytes: Uint8Array): DocumentParserInput {
  return {
    documentId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
    documentVersion: 1,
    sourceObjectKey: "quarantine/019b4e12-7ea3-7c36-9357-aea35ab542ca/source",
    sourceObjectVersion: "source-version",
    mediaType: "application/pdf",
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    createdAt: "2026-08-12T12:00:00.000Z",
    objectAccess: {
      accessKeyId: "ASIATESTEXACTOBJECT",
      secretAccessKey: "test-secret-access-key",
      sessionToken: "test-session-token",
      expiresAt: "2099-08-12T12:00:00.000Z",
    },
  };
}

describe("document parser Lambda boundary", () => {
  it("does not read bytes when the exact clean tag is absent", async () => {
    const send = vi.fn(async () => ({ TagSet: [] }));
    const handler = createDocumentParserHandler(
      { bucketName: "candidate-docs", kmsKeyArn: "kms-key", parserVersion: "parser-v1" },
      { send },
    );
    await expect(handler(input(minimalPdf()))).rejects.toThrow("GuardDutyCleanTagNotAvailable");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("fails closed before GetObject when immutable metadata does not match", async () => {
    const bytes = minimalPdf();
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        TagSet: [{ Key: "GuardDutyMalwareScanStatus", Value: "NO_THREATS_FOUND" }],
      })
      .mockResolvedValueOnce({
        VersionId: "source-version",
        ContentLength: bytes.byteLength + 1,
        ContentType: "application/pdf",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: "kms-key",
        Metadata: {
          "document-id": "019b4e12-7ea3-7c36-9357-aea35ab542ca",
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      });
    const handler = createDocumentParserHandler(
      { bucketName: "candidate-docs", kmsKeyArn: "kms-key", parserVersion: "parser-v1" },
      { send },
    );
    await expect(handler(input(bytes))).resolves.toEqual({
      ok: false,
      failureCode: "object_mismatch",
      reasonCode: "SOURCE_METADATA",
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("writes one deterministic normalized object after every exact clean check", async () => {
    const bytes = minimalPdf();
    const request = input(bytes);
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        TagSet: [{ Key: "GuardDutyMalwareScanStatus", Value: "NO_THREATS_FOUND" }],
      })
      .mockResolvedValueOnce({
        VersionId: request.sourceObjectVersion,
        ContentLength: bytes.byteLength,
        ContentType: request.mediaType,
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: "kms-key",
        Metadata: { "document-id": request.documentId, sha256: request.sha256 },
      })
      .mockResolvedValueOnce({
        Body: { transformToByteArray: async () => bytes },
      })
      .mockResolvedValueOnce({ VersionId: "normalized-version" });
    const handler = createDocumentParserHandler(
      { bucketName: "candidate-docs", kmsKeyArn: "kms-key", parserVersion: "parser-v1" },
      { send },
    );
    await expect(handler(request)).resolves.toMatchObject({
      ok: true,
      normalizedObjectKey: `normalized/${request.documentId}/${request.sha256}/parser-v1/resume.json`,
      normalizedObjectVersion: "normalized-version",
      parserVersion: "parser-v1",
      pageCount: 1,
      characterCount: 18,
    });
    expect(send).toHaveBeenCalledTimes(4);
    const put = send.mock.calls[3]?.[0] as { input?: Record<string, unknown> };
    expect(put.input).toMatchObject({
      Bucket: "candidate-docs",
      IfNoneMatch: "*",
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: "kms-key",
    });
    expect(JSON.stringify(put.input)).not.toContain("Skills: TypeScript");
  });
});
