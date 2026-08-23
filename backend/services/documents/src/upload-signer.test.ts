import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { MAXIMUM_RESUME_BYTES, S3ResumeUploadSigner } from "./upload-signer.js";

const documentId = "019bf123-4567-789a-8bcd-ef0123456789";
const kmsKeyArn = "arn:aws:kms:us-east-2:123456789012:key/01234567-89ab-cdef-0123-456789abcdef";

function signer(expiresSeconds = 300) {
  return new S3ResumeUploadSigner({
    bucket: "synthetic-candidate-documents",
    kmsKeyArn,
    expiresSeconds,
    now: () => new Date("2026-08-12T12:00:00.000Z"),
    client: new S3Client({
      region: "us-east-2",
      credentials: {
        accessKeyId: "SYNTHETICACCESSKEY",
        secretAccessKey: "synthetic-secret-for-signing-tests-only",
      },
    }),
  });
}

describe("S3ResumeUploadSigner", () => {
  it("binds a short-lived grant to one exact encrypted object and byte length", async () => {
    const result = await signer().createGrant({
      documentId,
      objectKey: `quarantine/${documentId}/source`,
      mediaType: "application/pdf",
      sizeBytes: 2048,
      sha256: "a".repeat(64),
    });
    const encodedPolicy = result.fields.policy ?? result.fields.Policy;
    expect(encodedPolicy).toBeTypeOf("string");
    const policy = JSON.parse(Buffer.from(encodedPolicy ?? "", "base64").toString("utf8")) as {
      conditions: unknown[];
    };

    expect(result).toMatchObject({
      url: "https://synthetic-candidate-documents.s3.us-east-2.amazonaws.com/",
      method: "POST",
      expiresAt: "2026-08-12T12:05:00.000Z",
      fields: {
        key: `quarantine/${documentId}/source`,
        "Content-Type": "application/pdf",
        "x-amz-checksum-algorithm": "SHA256",
        "x-amz-checksum-sha256": "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
        "x-amz-server-side-encryption": "aws:kms",
        "x-amz-server-side-encryption-aws-kms-key-id": kmsKeyArn,
        "x-amz-meta-document-id": documentId,
        "x-amz-meta-sha256": "a".repeat(64),
        success_action_status: "204",
      },
    });
    expect(policy.conditions).toContainEqual(["eq", "$x-amz-checksum-algorithm", "SHA256"]);
    expect(policy.conditions).toContainEqual([
      "eq",
      "$x-amz-checksum-sha256",
      "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
    ]);
    expect(policy.conditions).toContainEqual(["content-length-range", 2048, 2048]);
    expect(JSON.stringify(policy.conditions)).not.toContain("starts-with");
  });

  it("fails closed for an unrelated key, invalid digest, or oversized object", async () => {
    const create = (overrides: Partial<Parameters<ReturnType<typeof signer>["createGrant"]>[0]>) =>
      signer().createGrant({
        documentId,
        objectKey: `quarantine/${documentId}/source`,
        mediaType: "application/pdf",
        sizeBytes: 2048,
        sha256: "a".repeat(64),
        ...overrides,
      });

    await expect(create({ objectKey: "quarantine/other/source" })).rejects.toThrow(
      "outside the approved boundary",
    );
    await expect(create({ sha256: "not-a-digest" })).rejects.toThrow(
      "outside the approved boundary",
    );
    await expect(create({ sizeBytes: MAXIMUM_RESUME_BYTES + 1 })).rejects.toThrow(
      "outside the approved boundary",
    );
  });

  it("rejects upload grants longer than five minutes", () => {
    expect(() => signer(301)).toThrow("60 to 300 seconds");
  });
});
